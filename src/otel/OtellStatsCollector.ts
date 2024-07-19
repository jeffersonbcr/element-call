import {
  Room,
  RemoteParticipant,
  LocalParticipant,
  LocalTrackPublication,
  RemoteTrackPublication,
  ConnectionState,
} from "livekit-client";
import { logger } from "matrix-js-sdk/src/logger";
import { ElementCallOpenTelemetry } from "./otel";

// Function to extract the participant's name
export function extractNameFromIdentity(identity: string): string {
  const match = identity.match(/^@([^\:]+):/);
  return match ? match[1] : identity;
}

// Function to process tracks for a participant
async function processParticipantTracks(
  participant: RemoteParticipant | LocalParticipant,
  room: Room,
) {
  const trackTypes = [
    {
      type: "audio",
      tracks: participant.audioTrackPublications.values(),
    },
    {
      type: "video",
      tracks: participant.videoTrackPublications.values(),
    },
    {
      type: "allTracks",
      tracks: participant.trackPublications.values(),
    },
  ];

  for (const { type: trackType, tracks } of trackTypes) {
    for (const track of tracks) {
      try {
        if (track.isSubscribed && track.track) {
          const statsReport = await track.track.getRTCStatsReport();
          statsReport?.forEach((stats) => {
            logger.info("entrou foreach stats");
            if (statsReport) {
              if (
                [
                  "inbound-rtp",
                  "outbound-rtp",
                  "remote-inbound-rtp",
                  "remote-outbound-rtp",
                  "candidate-pair",
                  "transport",
                  "codec",
                  "data-channel",
                  "media-source",
                  "media-playout",
                ].includes(stats.type)
              ) {
                processStatsSendToOtelTraces(
                  stats,
                  stats.type,
                  participant,
                  track,
                  trackType,
                  room.name,
                );
                processStatsSendToOtelMetrics(
                  stats,
                  stats.type,
                  participant,
                  trackType,
                  room.name,
                );
              }
            } else {
              logger.info(
                `No stats available for ${participant.identity}, Track ${track.trackSid}.`,
              );
            }
          });
        } else {
          logger.info(
            `Track ${track.trackSid} by ${participant.identity} is not subscribed.`,
          );
        }
      } catch (error) {
        logger.error(
          `Error collecting stats for ${participant.identity}: ${error}`,
        );
      }
    }
  }
}

// Collect RTC statistics
export async function otelCollectMetricsRtcStats(room: Room): Promise<void> {
  if (room.state !== ConnectionState.Connected) {
    logger.info("Room is not connected, skipping stats collection.");
    return;
  }

  // Process stats for remotes participants
  for (const participant of room.remoteParticipants.values()) {
    await processParticipantTracks(participant, room);
  }

  // Process stats for local participant
  await processParticipantTracks(room.localParticipant, room);
  ElementCallOpenTelemetry.instance.forceFlush();
}

export function processStatsSendToOtelTraces(
  stats: any,
  statType: string,
  participant: RemoteParticipant | LocalParticipant,
  track: RemoteTrackPublication | LocalTrackPublication,
  trackType: string,
  roomName: string,
): void {
  logger.info("processStatsSendToOtelTraces");
  const span = ElementCallOpenTelemetry.instance.tracer.startSpan(
    `Room: ${roomName}, Participant: ${extractNameFromIdentity(participant.identity)}, RTCStatsType: ${statType}, TrackType: ${trackType}`,
  );
  span.setAttribute("stat.type", statType);
  span.setAttribute("track.sid", track.trackSid);
  span.setAttribute(
    "participant.identity",
    extractNameFromIdentity(participant.identity),
  );
  span.setAttribute("track.type", trackType);
  span.setAttribute("room.name", roomName);

  // Set span attributes based on stat type and other parameters
  switch (statType) {
    case "codec":
      span.setAttribute("codecId", stats.id);
      span.setAttribute("mimeType", stats.mimeType);
      span.setAttribute("clockRate", stats.clockRate);
      span.setAttribute("channels", stats.channels);
      span.setAttribute("sdpFmtpLine", stats.sdpFmtpLine);

      if (trackType === "audio") {
        span.setAttribute("channels", stats.channels);
        span.setAttribute("sdpFmtpLine", stats.sdpFmtpLine);
      } else if (trackType === "video" || trackType === "allTracks") {
        span.setAttribute("sdpFmtpLine", stats.sdpFmtpLine);
      }
      break;

    case "outbound-rtp":
      span.setAttribute("ssrc", stats.ssrc);
      span.setAttribute("kind", stats.kind);
      span.setAttribute("mediaType", stats.mediaType);
      span.setAttribute("bytesSent", stats.bytesSent);
      span.setAttribute("packetsSent", stats.packetsSent);
      span.setAttribute("headerBytesSent", stats.headerBytesSent);
      span.setAttribute("mediaSourceId", stats.mediaSourceId);
      span.setAttribute("mid", stats.mid);
      span.setAttribute("nackCount", stats.nackCount);
      span.setAttribute("remoteId", stats.remoteId);
      span.setAttribute("retransmittedBytesSent", stats.retransmittedBytesSent);
      span.setAttribute(
        "retransmittedPacketsSent",
        stats.retransmittedPacketsSent,
      );
      span.setAttribute("targetBitrate", stats.targetBitrate);
      span.setAttribute("totalPacketSendDelay", stats.totalPacketSendDelay);
      span.setAttribute("codecId", stats.codecId);
      span.setAttribute("transportId", stats.transportId);
      span.setAttribute("active", stats.active);

      if (trackType === "video") {
        span.setAttribute("encoderImplementation", stats.encoderImplementation);
        span.setAttribute("framesEncoded", stats.framesEncoded);
        span.setAttribute("frameHeight", stats.frameHeight);
        span.setAttribute("frameWidth", stats.frameWidth);
        span.setAttribute("framesPerSecond", stats.framesPerSecond);
        span.setAttribute("framesSent", stats.framesSent);
        span.setAttribute("hugeFramesSent", stats.hugeFramesSent);
        span.setAttribute("keyFramesEncoded", stats.keyFramesEncoded);
        span.setAttribute("powerEfficientEncoder", stats.powerEfficientEncoder);
        span.setAttribute("qpSum", stats.qpSum);
        span.setAttribute(
          "qualityLimitationDurations",
          JSON.stringify(stats.qualityLimitationDurations),
        );
        span.setAttribute(
          "qualityLimitationReason",
          stats.qualityLimitationReason,
        );
        span.setAttribute(
          "qualityLimitationResolutionChanges",
          stats.qualityLimitationResolutionChanges,
        );
        span.setAttribute("rid", stats.rid);
        span.setAttribute("rtxSsrc", stats.rtxSsrc);
        span.setAttribute("scalabilityMode", stats.scalabilityMode);
        span.setAttribute("totalEncodeTime", stats.totalEncodeTime);
        span.setAttribute(
          "totalEncodedBytesTarget",
          stats.totalEncodedBytesTarget,
        );
      } else if (trackType === "allTracks") {
        if (stats.contentType === "screenshare") {
          span.setAttribute("contentType", stats.contentType);
          span.setAttribute(
            "encoderImplementation",
            stats.encoderImplementation,
          );
          span.setAttribute("framesEncoded", stats.framesEncoded);
          span.setAttribute("frameHeight", stats.frameHeight);
          span.setAttribute("frameWidth", stats.frameWidth);
          span.setAttribute("framesPerSecond", stats.framesPerSecond);
          span.setAttribute("framesSent", stats.framesSent);
          span.setAttribute("hugeFramesSent", stats.hugeFramesSent);
          span.setAttribute("keyFramesEncoded", stats.keyFramesEncoded);
          span.setAttribute(
            "powerEfficientEncoder",
            stats.powerEfficientEncoder,
          );
          span.setAttribute("qpSum", stats.qpSum);
          span.setAttribute(
            "qualityLimitationDurations",
            JSON.stringify(stats.qualityLimitationDurations),
          );
          span.setAttribute(
            "qualityLimitationReason",
            stats.qualityLimitationReason,
          );
          span.setAttribute(
            "qualityLimitationResolutionChanges",
            stats.qualityLimitationResolutionChanges,
          );
          span.setAttribute("rid", stats.rid);
          span.setAttribute("rtxSsrc", stats.rtxSsrc);
          span.setAttribute("scalabilityMode", stats.scalabilityMode);
          span.setAttribute("totalEncodeTime", stats.totalEncodeTime);
          span.setAttribute(
            "totalEncodedBytesTarget",
            stats.totalEncodedBytesTarget,
          );
        }
      }
      break;

    case "remote-outbound-rtp":
      span.setAttribute("ssrc", stats.ssrc);
      span.setAttribute("kind", stats.kind);
      span.setAttribute("mediaType", stats.mediaType);
      span.setAttribute("bytesSent", stats.bytesSent);
      span.setAttribute("packetsSent", stats.packetsSent);
      span.setAttribute("localId", stats.localId);
      span.setAttribute("remoteTimestamp", stats.remoteTimestamp);
      span.setAttribute("reportsSent", stats.reportsSent);
      span.setAttribute(
        "roundTripTimeMeasurements",
        stats.roundTripTimeMeasurements,
      );
      span.setAttribute("totalRoundTripTime", stats.totalRoundTripTime);
      span.setAttribute("codecId", stats.codecId);
      span.setAttribute("transportId", stats.transportId);
      break;

    case "inbound-rtp":
      span.setAttribute("ssrc", stats.ssrc);
      span.setAttribute("kind", stats.kind);
      span.setAttribute("mediaType", stats.mediaType);
      span.setAttribute("bytesReceived", stats.bytesReceived);
      span.setAttribute("packetsReceived", stats.packetsReceived);
      span.setAttribute("jitter", stats.jitter);
      span.setAttribute("packetsLost", stats.packetsLost);
      if (trackType === "audio") {
        span.setAttribute("audioLevel", stats.audioLevel);
        span.setAttribute("concealedSamples", stats.concealedSamples);
        span.setAttribute("concealmentEvents", stats.concealmentEvents);
        span.setAttribute("fecPacketsDiscarded", stats.fecPacketsDiscarded);
        span.setAttribute("fecPacketsReceived", stats.fecPacketsReceived);
        span.setAttribute("headerBytesReceived", stats.headerBytesReceived);
        span.setAttribute(
          "insertedSamplesForDeceleration",
          stats.insertedSamplesForDeceleration,
        );
        span.setAttribute("jitterBufferDelay", stats.jitterBufferDelay);
        span.setAttribute(
          "jitterBufferEmittedCount",
          stats.jitterBufferEmittedCount,
        );
        span.setAttribute(
          "jitterBufferMinimumDelay",
          stats.jitterBufferMinimumDelay,
        );
        span.setAttribute(
          "jitterBufferTargetDelay",
          stats.jitterBufferTargetDelay,
        );
        span.setAttribute(
          "lastPacketReceivedTimestamp",
          stats.lastPacketReceivedTimestamp,
        );
        span.setAttribute("mid", stats.mid);
        span.setAttribute("nackCount", stats.nackCount);
        span.setAttribute("packetsDiscarded", stats.packetsDiscarded);
        span.setAttribute("playoutId", stats.playoutId);
        span.setAttribute("remoteId", stats.remoteId);
        span.setAttribute(
          "removedSamplesForAcceleration",
          stats.removedSamplesForAcceleration,
        );
        span.setAttribute(
          "silentConcealedSamples",
          stats.silentConcealedSamples,
        );
        span.setAttribute("totalAudioEnergy", stats.totalAudioEnergy);
        span.setAttribute("totalSamplesDuration", stats.totalSamplesDuration);
        span.setAttribute("totalSamplesReceived", stats.totalSamplesReceived);
        span.setAttribute("trackIdentifier", stats.trackIdentifier);
      } else if (trackType === "video") {
        span.setAttribute("decoderImplementation", stats.decoderImplementation);
        span.setAttribute("firCount", stats.firCount);
        span.setAttribute("frameHeight", stats.frameHeight);
        span.setAttribute("frameWidth", stats.frameWidth);
        span.setAttribute(
          "framesAssembledFromMultiplePackets",
          stats.framesAssembledFromMultiplePackets,
        );
        span.setAttribute("framesDecoded", stats.framesDecoded);
        span.setAttribute("framesDropped", stats.framesDropped);
        span.setAttribute("framesPerSecond", stats.framesPerSecond);
        span.setAttribute("framesReceived", stats.framesReceived);
        span.setAttribute("freezeCount", stats.freezeCount);
        span.setAttribute("headerBytesReceived", stats.headerBytesReceived);
        span.setAttribute("jitterBufferDelay", stats.jitterBufferDelay);
        span.setAttribute(
          "jitterBufferEmittedCount",
          stats.jitterBufferEmittedCount,
        );
        span.setAttribute(
          "jitterBufferMinimumDelay",
          stats.jitterBufferMinimumDelay,
        );
        span.setAttribute(
          "jitterBufferTargetDelay",
          stats.jitterBufferTargetDelay,
        );
        span.setAttribute("keyFramesDecoded", stats.keyFramesDecoded);
        span.setAttribute(
          "lastPacketReceivedTimestamp",
          stats.lastPacketReceivedTimestamp,
        );
        span.setAttribute("mid", stats.mid);
        span.setAttribute("nackCount", stats.nackCount);
        span.setAttribute("pauseCount", stats.pauseCount);
        span.setAttribute("pliCount", stats.pliCount);
        span.setAttribute("powerEfficientDecoder", stats.powerEfficientDecoder);
        span.setAttribute("qpSum", stats.qpSum);
        span.setAttribute("remoteId", stats.remoteId);
        span.setAttribute("totalAssemblyTime", stats.totalAssemblyTime);
        span.setAttribute("totalDecodeTime", stats.totalDecodeTime);
        span.setAttribute("totalFreezesDuration", stats.totalFreezesDuration);
        span.setAttribute("totalInterFrameDelay", stats.totalInterFrameDelay);
        span.setAttribute("totalPausesDuration", stats.totalPausesDuration);
        span.setAttribute("totalProcessingDelay", stats.totalProcessingDelay);
        span.setAttribute(
          "totalSquaredInterFrameDelay",
          stats.totalSquaredInterFrameDelay,
        );
        span.setAttribute("trackIdentifier", stats.trackIdentifier);
      }
      break;

    case "remote-inbound-rtp":
      span.setAttribute("ssrc", stats.ssrc);
      span.setAttribute("kind", stats.kind);
      span.setAttribute("mediaType", stats.mediaType);
      span.setAttribute("jitter", stats.jitter);
      span.setAttribute("packetsLost", stats.packetsLost);
      span.setAttribute("fractionLost", stats.fractionLost);
      span.setAttribute("localId", stats.localId);
      span.setAttribute("roundTripTime", stats.roundTripTime);
      span.setAttribute(
        "roundTripTimeMeasurements",
        stats.roundTripTimeMeasurements,
      );
      span.setAttribute("totalRoundTripTime", stats.totalRoundTripTime);
      span.setAttribute("codecId", stats.codecId);
      span.setAttribute("transportId", stats.transportId);
      break;

    case "candidate-pair":
      span.setAttribute(
        "availableIncomingBitrate",
        stats.availableIncomingBitrate,
      );
      span.setAttribute(
        "availableOutgoingBitrate",
        stats.availableOutgoingBitrate,
      );
      span.setAttribute("bytesDiscardedOnSend", stats.bytesDiscardedOnSend);
      span.setAttribute("bytesReceived", stats.bytesReceived);
      span.setAttribute("bytesSent", stats.bytesSent);
      span.setAttribute("consentRequestsSent", stats.consentRequestsSent);
      span.setAttribute("currentRoundTripTime", stats.currentRoundTripTime);
      span.setAttribute(
        "lastPacketReceivedTimestamp",
        stats.lastPacketReceivedTimestamp,
      );
      span.setAttribute(
        "lastPacketSentTimestamp",
        stats.lastPacketSentTimestamp,
      );
      span.setAttribute("localCandidateId", stats.localCandidateId);
      span.setAttribute("nominated", stats.nominated);
      span.setAttribute("packetsDiscardedOnSend", stats.packetsDiscardedOnSend);
      span.setAttribute("packetsReceived", stats.packetsReceived);
      span.setAttribute("packetsSent", stats.packetsSent);
      span.setAttribute("priority", stats.priority);
      span.setAttribute("remoteCandidateId", stats.remoteCandidateId);
      span.setAttribute("requestsReceived", stats.requestsReceived);
      span.setAttribute("requestsSent", stats.requestsSent);
      span.setAttribute("responsesReceived", stats.responsesReceived);
      span.setAttribute("responsesSent", stats.responsesSent);
      span.setAttribute("state", stats.state);
      span.setAttribute("totalRoundTripTime", stats.totalRoundTripTime);
      span.setAttribute("transportId", stats.transportId);
      span.setAttribute("writable", stats.writable);
      break;

    case "transport":
      span.setAttribute("bytesReceived", stats.bytesReceived);
      span.setAttribute("bytesSent", stats.bytesSent);
      span.setAttribute("dtlsCipher", stats.dtlsCipher);
      span.setAttribute("dtlsRole", stats.dtlsRole);
      span.setAttribute("dtlsState", stats.dtlsState);
      span.setAttribute(
        "iceLocalUsernameFragment",
        stats.iceLocalUsernameFragment,
      );
      span.setAttribute("iceRole", stats.iceRole);
      span.setAttribute("iceState", stats.iceState);
      span.setAttribute("localCertificateId", stats.localCertificateId);
      span.setAttribute("packetsReceived", stats.packetsReceived);
      span.setAttribute("packetsSent", stats.packetsSent);
      span.setAttribute("remoteCertificateId", stats.remoteCertificateId);
      span.setAttribute(
        "selectedCandidatePairChanges",
        stats.selectedCandidatePairChanges,
      );
      span.setAttribute(
        "selectedCandidatePairId",
        stats.selectedCandidatePairId,
      );
      span.setAttribute("srtpCipher", stats.srtpCipher);
      span.setAttribute("tlsVersion", stats.tlsVersion);
      break;

    case "data-channel":
      span.setAttribute("datachannelid", stats.dataChannelId);
      span.setAttribute("state", stats.state);
      span.setAttribute("messagesSent", stats.messagesSent);
      span.setAttribute("bytesSent", stats.bytesSent);
      span.setAttribute("messagesReceived", stats.messagesReceived);
      span.setAttribute("bytesReceived", stats.bytesReceived);
      break;

    case "media-source":
      span.setAttribute("trackIdentifier", stats.trackIdentifier);
      span.setAttribute("kind", stats.kind);
      span.setAttribute("audioLevel", stats.audioLevel);
      span.setAttribute("totalAudioEnergy", stats.totalAudioEnergy);
      span.setAttribute("totalSamplesDuration", stats.totalSamplesDuration);
      span.setAttribute("echoReturnLoss", stats.echoReturnLoss);
      span.setAttribute(
        "echoReturnLossEnhancement",
        stats.echoReturnLossEnhancement,
      );
      break;

    case "media-playout":
      span.setAttribute("kind", stats.kind);
      span.setAttribute(
        "synthesizedSamplesDuration",
        stats.synthesizedSamplesDuration,
      );
      span.setAttribute(
        "synthesizedSamplesEvents",
        stats.synthesizedSamplesEvents,
      );
      span.setAttribute("totalPlayoutDelay", stats.totalPlayoutDelay);
      span.setAttribute("totalSamplesCount", stats.totalSamplesCount);
      span.setAttribute("totalSamplesDuration", stats.totalSamplesDuration);
      break;
  }

  span.end();
}

// Process stats and send to Opentelemetry endpoint Metrics
export function processStatsSendToOtelMetrics(
  stats: any,
  statType: string,
  participant: RemoteParticipant | LocalParticipant,
  trackType: string,
  roomName: string,
): void {
  // Get the meter provider and meter
  const meterProvider = ElementCallOpenTelemetry.instance.meterProvider;
  const meter = meterProvider.getMeter("element-call-meter");
  const participantName = extractNameFromIdentity(participant.identity);
  logger.info("Entrou metrics");
  // logger.info(
  //   "processStatsSendToOtelMetrics: ",
  //   stats,
  //   statType,
  //   participant,
  //   trackType,
  //   roomName,
  // );
  // Process metrics based on stat type
  switch (statType) {
    case "codec":
      if (trackType === "audio") {
        const codecAudioMetrics = {
          clockRate: meter.createHistogram("codec_audio_clock_rate", {
            description: "Clock rate of the audio codec",
          }),
          channels: meter.createGauge("codec_audio_channels", {
            description: "Channels of the audio codec",
          }),
          mimeType: meter.createCounter("codec_audio_mime_type_count", {
            description: "Count of MIME types of the audio codec",
          }),
          sdpFmtpLine: meter.createCounter("codec_audio_sdp_fmtp_line_count", {
            description: "Count of SDP fmtp lines of the audio codec",
          }),
        };
        codecAudioMetrics.clockRate.record(stats.clockRate || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        codecAudioMetrics.channels.record(stats.channels || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        codecAudioMetrics.mimeType.add(1, {
          participant: participantName,
          trackType,
          roomName,
          mimeType: stats.mimeType || "",
        });
        codecAudioMetrics.sdpFmtpLine.add(1, {
          participant: participantName,
          trackType,
          roomName,
          sdpFmtpLine: stats.sdpFmtpLine || "",
        });
      } else if (trackType === "video") {
        const codecVideoMetrics = {
          clockRate: meter.createHistogram("codec_video_clock_rate", {
            description: "Clock rate of the video codec",
          }),
          mimeType: meter.createCounter("codec_video_mime_type_count", {
            description: "Count of MIME types of the video codec",
          }),
          sdpFmtpLine: meter.createCounter("codec_video_sdp_fmtp_line_count", {
            description: "Count of SDP fmtp lines of the video codec",
          }),
        };
        codecVideoMetrics.clockRate.record(stats.clockRate || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        codecVideoMetrics.mimeType.add(1, {
          participant: participantName,
          trackType,
          roomName,
          mimeType: stats.mimeType || "",
        });
        codecVideoMetrics.sdpFmtpLine.add(1, {
          participant: participantName,
          trackType,
          roomName,
          sdpFmtpLine: stats.sdpFmtpLine || "",
        });
      } else if (trackType === "allTracks") {
        const codecAllTracksMetrics = {
          clockRate: meter.createHistogram("codec_all_tracks_clock_rate", {
            description: "Clock rate of the codec for all tracks",
          }),
          mimeType: meter.createCounter("codec_all_tracks_mime_type_count", {
            description: "Count of MIME types of the codec for all tracks",
          }),
          sdpFmtpLine: meter.createCounter(
            "codec_all_tracks_sdp_fmtp_line_count",
            {
              description:
                "Count of SDP fmtp lines of the codec for all tracks",
            },
          ),
        };
        codecAllTracksMetrics.clockRate.record(stats.clockRate || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        codecAllTracksMetrics.mimeType.add(1, {
          participant: participantName,
          trackType,
          roomName,
          mimeType: stats.mimeType || "",
        });
        codecAllTracksMetrics.sdpFmtpLine.add(1, {
          participant: participantName,
          trackType,
          roomName,
          sdpFmtpLine: stats.sdpFmtpLine || "",
        });
      }
      break;

    case "outbound-rtp":
      if (trackType === "audio") {
        const outboundRtpAudioMetrics = {
          bytesSent: meter.createHistogram("outbound_rtp_audio_bytes_sent", {
            description: "Bytes sent for outbound RTP audio",
          }),
          packetsSent: meter.createCounter("outbound_rtp_audio_packets_sent", {
            description: "Packets sent for outbound RTP audio",
          }),
          targetBitrate: meter.createGauge(
            "outbound_rtp_audio_target_bitrate",
            {
              description: "Target bitrate for outbound RTP audio",
            },
          ),
          headerBytesSent: meter.createHistogram(
            "outbound_rtp_audio_header_bytes_sent",
            {
              description: "Header bytes sent for outbound RTP audio",
            },
          ),
          nackCount: meter.createCounter("outbound_rtp_audio_nack_count", {
            description: "NACK count for outbound RTP audio",
          }),
          retransmittedBytesSent: meter.createHistogram(
            "outbound_rtp_audio_retransmitted_bytes_sent",
            {
              description: "Retransmitted bytes sent for outbound RTP audio",
            },
          ),
          retransmittedPacketsSent: meter.createCounter(
            "outbound_rtp_audio_retransmitted_packets_sent",
            {
              description: "Retransmitted packets sent for outbound RTP audio",
            },
          ),
          totalPacketSendDelay: meter.createHistogram(
            "outbound_rtp_audio_total_packet_send_delay",
            {
              description: "Total packet send delay for outbound RTP audio",
            },
          ),
        };
        outboundRtpAudioMetrics.bytesSent.record(stats.bytesSent || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        outboundRtpAudioMetrics.packetsSent.add(stats.packetsSent || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        outboundRtpAudioMetrics.targetBitrate.record(stats.targetBitrate || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        outboundRtpAudioMetrics.headerBytesSent.record(
          stats.headerBytesSent || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        outboundRtpAudioMetrics.nackCount.add(stats.nackCount || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        outboundRtpAudioMetrics.retransmittedBytesSent.record(
          stats.retransmittedBytesSent || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        outboundRtpAudioMetrics.retransmittedPacketsSent.add(
          stats.retransmittedPacketsSent || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        outboundRtpAudioMetrics.totalPacketSendDelay.record(
          stats.totalPacketSendDelay || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
      } else if (trackType === "video") {
        const outboundRtpVideoMetrics = {
          bytesSent: meter.createHistogram("outbound_rtp_video_bytes_sent", {
            description: "Bytes sent for outbound RTP video",
          }),
          packetsSent: meter.createCounter("outbound_rtp_video_packets_sent", {
            description: "Packets sent for outbound RTP video",
          }),
          targetBitrate: meter.createGauge(
            "outbound_rtp_video_target_bitrate",
            {
              description: "Target bitrate for outbound RTP video",
            },
          ),
          headerBytesSent: meter.createHistogram(
            "outbound_rtp_video_header_bytes_sent",
            {
              description: "Header bytes sent for outbound RTP video",
            },
          ),
          nackCount: meter.createCounter("outbound_rtp_video_nack_count", {
            description: "NACK count for outbound RTP video",
          }),
          retransmittedBytesSent: meter.createHistogram(
            "outbound_rtp_video_retransmitted_bytes_sent",
            {
              description: "Retransmitted bytes sent for outbound RTP video",
            },
          ),
          retransmittedPacketsSent: meter.createCounter(
            "outbound_rtp_video_retransmitted_packets_sent",
            {
              description: "Retransmitted packets sent for outbound RTP video",
            },
          ),
          totalPacketSendDelay: meter.createHistogram(
            "outbound_rtp_video_total_packet_send_delay",
            {
              description: "Total packet send delay for outbound RTP video",
            },
          ),
          frameHeight: meter.createGauge("outbound_rtp_video_frame_height", {
            description: "Frame height for outbound RTP video",
          }),
          frameWidth: meter.createGauge("outbound_rtp_video_frame_width", {
            description: "Frame width for outbound RTP video",
          }),
          framesEncoded: meter.createCounter(
            "outbound_rtp_video_frames_encoded",
            {
              description: "Frames encoded for outbound RTP video",
            },
          ),
          framesPerSecond: meter.createGauge(
            "outbound_rtp_video_frames_per_second",
            {
              description: "Frames per second for outbound RTP video",
            },
          ),
          framesSent: meter.createCounter("outbound_rtp_video_frames_sent", {
            description: "Frames sent for outbound RTP video",
          }),
          keyFramesEncoded: meter.createCounter(
            "outbound_rtp_video_key_frames_encoded",
            {
              description: "Key frames encoded for outbound RTP video",
            },
          ),
          totalEncodeTime: meter.createHistogram(
            "outbound_rtp_video_total_encode_time",
            {
              description: "Total encode time for outbound RTP video",
            },
          ),
        };
        outboundRtpVideoMetrics.bytesSent.record(stats.bytesSent || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        outboundRtpVideoMetrics.packetsSent.add(stats.packetsSent || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        outboundRtpVideoMetrics.targetBitrate.record(stats.targetBitrate || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        outboundRtpVideoMetrics.headerBytesSent.record(
          stats.headerBytesSent || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        outboundRtpVideoMetrics.nackCount.add(stats.nackCount || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        outboundRtpVideoMetrics.retransmittedBytesSent.record(
          stats.retransmittedBytesSent || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        outboundRtpVideoMetrics.retransmittedPacketsSent.add(
          stats.retransmittedPacketsSent || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        outboundRtpVideoMetrics.totalPacketSendDelay.record(
          stats.totalPacketSendDelay || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        outboundRtpVideoMetrics.frameHeight.record(stats.frameHeight || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        outboundRtpVideoMetrics.frameWidth.record(stats.frameWidth || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        outboundRtpVideoMetrics.framesEncoded.add(stats.framesEncoded || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        outboundRtpVideoMetrics.framesPerSecond.record(
          stats.framesPerSecond || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        outboundRtpVideoMetrics.framesSent.add(stats.framesSent || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        outboundRtpVideoMetrics.keyFramesEncoded.add(
          stats.keyFramesEncoded || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        outboundRtpVideoMetrics.totalEncodeTime.record(
          stats.totalEncodeTime || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
      } else if (trackType === "allTracks") {
        const outboundRtpAllTracksMetrics = {
          bytesSent: meter.createHistogram(
            "outbound_rtp_all_tracks_bytes_sent",
            {
              description: "Bytes sent for outbound RTP all tracks",
            },
          ),
          packetsSent: meter.createCounter(
            "outbound_rtp_all_tracks_packets_sent",
            {
              description: "Packets sent for outbound RTP all tracks",
            },
          ),
          targetBitrate: meter.createGauge(
            "outbound_rtp_all_tracks_target_bitrate",
            {
              description: "Target bitrate for outbound RTP all tracks",
            },
          ),
          headerBytesSent: meter.createHistogram(
            "outbound_rtp_all_tracks_header_bytes_sent",
            {
              description: "Header bytes sent for outbound RTP all tracks",
            },
          ),
          nackCount: meter.createCounter("outbound_rtp_all_tracks_nack_count", {
            description: "NACK count for outbound RTP all tracks",
          }),
          retransmittedBytesSent: meter.createHistogram(
            "outbound_rtp_all_tracks_retransmitted_bytes_sent",
            {
              description:
                "Retransmitted bytes sent for outbound RTP all tracks",
            },
          ),
          retransmittedPacketsSent: meter.createCounter(
            "outbound_rtp_all_tracks_retransmitted_packets_sent",
            {
              description:
                "Retransmitted packets sent for outbound RTP all tracks",
            },
          ),
          totalPacketSendDelay: meter.createHistogram(
            "outbound_rtp_all_tracks_total_packet_send_delay",
            {
              description:
                "Total packet send delay for outbound RTP all tracks",
            },
          ),
        };
        outboundRtpAllTracksMetrics.bytesSent.record(stats.bytesSent || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        outboundRtpAllTracksMetrics.packetsSent.add(stats.packetsSent || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        outboundRtpAllTracksMetrics.targetBitrate.record(
          stats.targetBitrate || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        outboundRtpAllTracksMetrics.headerBytesSent.record(
          stats.headerBytesSent || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        outboundRtpAllTracksMetrics.nackCount.add(stats.nackCount || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        outboundRtpAllTracksMetrics.retransmittedBytesSent.record(
          stats.retransmittedBytesSent || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        outboundRtpAllTracksMetrics.retransmittedPacketsSent.add(
          stats.retransmittedPacketsSent || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        outboundRtpAllTracksMetrics.totalPacketSendDelay.record(
          stats.totalPacketSendDelay || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );

        if (stats.contentType === "screenshare") {
          const outboundRtpScreenshareMetrics = {
            contentType: meter.createCounter(
              "outbound_rtp_screenshare_content_type",
              {
                description: "Count of outbound RTP screenshare content type",
              },
            ),
            encoderImplementation: meter.createCounter(
              "outbound_rtp_screenshare_encoder_implementation",
              {
                description:
                  "Encoder implementation for outbound RTP screenshare",
              },
            ),
            framesEncoded: meter.createCounter(
              "outbound_rtp_screenshare_frames_encoded",
              {
                description: "Frames encoded for outbound RTP screenshare",
              },
            ),
            frameHeight: meter.createGauge(
              "outbound_rtp_screenshare_frame_height",
              {
                description: "Frame height for outbound RTP screenshare",
              },
            ),
            frameWidth: meter.createGauge(
              "outbound_rtp_screenshare_frame_width",
              {
                description: "Frame width for outbound RTP screenshare",
              },
            ),
            framesPerSecond: meter.createGauge(
              "outbound_rtp_screenshare_frames_per_second",
              {
                description: "Frames per second for outbound RTP screenshare",
              },
            ),
            framesSent: meter.createCounter(
              "outbound_rtp_screenshare_frames_sent",
              {
                description: "Frames sent for outbound RTP screenshare",
              },
            ),
            keyFramesEncoded: meter.createCounter(
              "outbound_rtp_screenshare_key_frames_encoded",
              {
                description: "Key frames encoded for outbound RTP screenshare",
              },
            ),
            totalEncodeTime: meter.createHistogram(
              "outbound_rtp_screenshare_total_encode_time",
              {
                description: "Total encode time for outbound RTP screenshare",
              },
            ),
          };
          outboundRtpScreenshareMetrics.contentType.add(1, {
            participant: participantName,
            trackType,
            roomName,
          });
          outboundRtpScreenshareMetrics.encoderImplementation.add(1, {
            participant: participantName,
            trackType,
            roomName,
            encoderImplementation: stats.encoderImplementation || "",
          });
          outboundRtpScreenshareMetrics.framesEncoded.add(
            stats.framesEncoded || 0,
            {
              participant: participantName,
              trackType,
              roomName,
            },
          );
          outboundRtpScreenshareMetrics.frameHeight.record(
            stats.frameHeight || 0,
            {
              participant: participantName,
              trackType,
              roomName,
            },
          );
          outboundRtpScreenshareMetrics.frameWidth.record(
            stats.frameWidth || 0,
            {
              participant: participantName,
              trackType,
              roomName,
            },
          );
          outboundRtpScreenshareMetrics.framesPerSecond.record(
            stats.framesPerSecond || 0,
            {
              participant: participantName,
              trackType,
              roomName,
            },
          );
          outboundRtpScreenshareMetrics.framesSent.add(stats.framesSent || 0, {
            participant: participantName,
            trackType,
            roomName,
          });
          outboundRtpScreenshareMetrics.keyFramesEncoded.add(
            stats.keyFramesEncoded || 0,
            {
              participant: participantName,
              trackType,
              roomName,
            },
          );
          outboundRtpScreenshareMetrics.totalEncodeTime.record(
            stats.totalEncodeTime || 0,
            {
              participant: participantName,
              trackType,
              roomName,
            },
          );
        }
      }
      break;

    case "inbound-rtp":
      if (trackType === "audio") {
        const audioMetrics = {
          bytesReceived: meter.createHistogram(
            "inbound_rtp_audio_bytes_received",
            {
              description: "Bytes received for inbound RTP audio",
            },
          ),
          packetsReceived: meter.createCounter(
            "inbound_rtp_audio_packets_received",
            {
              description: "Packets received for inbound RTP audio",
            },
          ),
          jitter: meter.createGauge("inbound_rtp_audio_jitter", {
            description: "Jitter for inbound RTP audio",
          }),
          packetsLost: meter.createCounter("inbound_rtp_audio_packets_lost", {
            description: "Packets lost for inbound RTP audio",
          }),
          audioLevel: meter.createGauge("inbound_rtp_audio_level", {
            description: "Audio level for inbound RTP audio",
          }),
          concealedSamples: meter.createCounter(
            "inbound_rtp_audio_concealed_samples",
            {
              description: "Concealed samples for inbound RTP audio",
            },
          ),
          concealmentEvents: meter.createCounter(
            "inbound_rtp_audio_concealment_events",
            {
              description: "Concealment events for inbound RTP audio",
            },
          ),
          fecPacketsDiscarded: meter.createCounter(
            "inbound_rtp_audio_fec_packets_discarded",
            {
              description: "FEC packets discarded for inbound RTP audio",
            },
          ),
          fecPacketsReceived: meter.createCounter(
            "inbound_rtp_audio_fec_packets_received",
            {
              description: "FEC packets received for inbound RTP audio",
            },
          ),
          headerBytesReceived: meter.createHistogram(
            "inbound_rtp_audio_header_bytes_received",
            {
              description: "Header bytes received for inbound RTP audio",
            },
          ),
          insertedSamplesForDeceleration: meter.createCounter(
            "inbound_rtp_audio_inserted_samples_for_deceleration",
            {
              description:
                "Inserted samples for deceleration for inbound RTP audio",
            },
          ),
          jitterBufferDelay: meter.createHistogram(
            "inbound_rtp_audio_jitter_buffer_delay",
            {
              description: "Jitter buffer delay for inbound RTP audio",
            },
          ),
          jitterBufferEmittedCount: meter.createCounter(
            "inbound_rtp_audio_jitter_buffer_emitted_count",
            {
              description: "Jitter buffer emitted count for inbound RTP audio",
            },
          ),
          jitterBufferMinimumDelay: meter.createHistogram(
            "inbound_rtp_audio_jitter_buffer_minimum_delay",
            {
              description: "Jitter buffer minimum delay for inbound RTP audio",
            },
          ),
          jitterBufferTargetDelay: meter.createHistogram(
            "inbound_rtp_audio_jitter_buffer_target_delay",
            {
              description: "Jitter buffer target delay for inbound RTP audio",
            },
          ),
          lastPacketReceivedTimestamp: meter.createHistogram(
            "inbound_rtp_audio_last_packet_received_timestamp",
            {
              description:
                "Last packet received timestamp for inbound RTP audio",
            },
          ),
          nackCount: meter.createCounter("inbound_rtp_audio_nack_count", {
            description: "NACK count for inbound RTP audio",
          }),
          packetsDiscarded: meter.createCounter(
            "inbound_rtp_audio_packets_discarded",
            {
              description: "Packets discarded for inbound RTP audio",
            },
          ),
          playoutId: meter.createCounter("inbound_rtp_audio_playout_id", {
            description: "Playout ID for inbound RTP audio",
          }),
          removedSamplesForAcceleration: meter.createCounter(
            "inbound_rtp_audio_removed_samples_for_acceleration",
            {
              description:
                "Removed samples for acceleration for inbound RTP audio",
            },
          ),
          silentConcealedSamples: meter.createCounter(
            "inbound_rtp_audio_silent_concealed_samples",
            {
              description: "Silent concealed samples for inbound RTP audio",
            },
          ),
          totalAudioEnergy: meter.createHistogram(
            "inbound_rtp_audio_total_audio_energy",
            {
              description: "Total audio energy for inbound RTP audio",
            },
          ),
          totalSamplesDuration: meter.createHistogram(
            "inbound_rtp_audio_total_samples_duration",
            {
              description: "Total samples duration for inbound RTP audio",
            },
          ),
          totalSamplesReceived: meter.createCounter(
            "inbound_rtp_audio_total_samples_received",
            {
              description: "Total samples received for inbound RTP audio",
            },
          ),
          trackIdentifier: meter.createCounter(
            "inbound_rtp_audio_track_identifier",
            {
              description: "Track identifier for inbound RTP audio",
            },
          ),
        };

        audioMetrics.bytesReceived.record(stats.bytesReceived || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        audioMetrics.packetsReceived.add(stats.packetsReceived || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        audioMetrics.jitter.record(stats.jitter || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        audioMetrics.packetsLost.add(stats.packetsLost || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        audioMetrics.audioLevel.record(stats.audioLevel || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        audioMetrics.concealedSamples.add(stats.concealedSamples || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        audioMetrics.concealmentEvents.add(stats.concealmentEvents || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        audioMetrics.fecPacketsDiscarded.add(stats.fecPacketsDiscarded || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        audioMetrics.fecPacketsReceived.add(stats.fecPacketsReceived || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        audioMetrics.headerBytesReceived.record(
          stats.headerBytesReceived || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        audioMetrics.insertedSamplesForDeceleration.add(
          stats.insertedSamplesForDeceleration || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        audioMetrics.jitterBufferDelay.record(stats.jitterBufferDelay || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        audioMetrics.jitterBufferEmittedCount.add(
          stats.jitterBufferEmittedCount || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        audioMetrics.jitterBufferMinimumDelay.record(
          stats.jitterBufferMinimumDelay || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        audioMetrics.jitterBufferTargetDelay.record(
          stats.jitterBufferTargetDelay || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        audioMetrics.lastPacketReceivedTimestamp.record(
          stats.lastPacketReceivedTimestamp || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        audioMetrics.nackCount.add(stats.nackCount || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        audioMetrics.packetsDiscarded.add(stats.packetsDiscarded || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        audioMetrics.playoutId.add(stats.playoutId || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        audioMetrics.removedSamplesForAcceleration.add(
          stats.removedSamplesForAcceleration || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        audioMetrics.silentConcealedSamples.add(
          stats.silentConcealedSamples || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        audioMetrics.totalAudioEnergy.record(stats.totalAudioEnergy || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        audioMetrics.totalSamplesDuration.record(
          stats.totalSamplesDuration || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        audioMetrics.totalSamplesReceived.add(stats.totalSamplesReceived || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        audioMetrics.trackIdentifier.add(stats.trackIdentifier || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
      } else if (trackType === "video") {
        const videoMetrics = {
          decoderImplementation: meter.createGauge(
            "inbound_rtp_video_decoder_implementation",
            {
              description: "Decoder implementation for inbound RTP video",
            },
          ),
          firCount: meter.createCounter("inbound_rtp_video_fir_count", {
            description: "FIR count for inbound RTP video",
          }),
          frameHeight: meter.createGauge("inbound_rtp_video_frame_height", {
            description: "Frame height for inbound RTP video",
          }),
          frameWidth: meter.createGauge("inbound_rtp_video_frame_width", {
            description: "Frame width for inbound RTP video",
          }),
          framesAssembledFromMultiplePackets: meter.createCounter(
            "inbound_rtp_video_frames_assembled_from_multiple_packets",
            {
              description:
                "Frames assembled from multiple packets for inbound RTP video",
            },
          ),
          framesDecoded: meter.createCounter(
            "inbound_rtp_video_frames_decoded",
            {
              description: "Frames decoded for inbound RTP video",
            },
          ),
          framesDropped: meter.createCounter(
            "inbound_rtp_video_frames_dropped",
            {
              description: "Frames dropped for inbound RTP video",
            },
          ),
          framesPerSecond: meter.createGauge(
            "inbound_rtp_video_frames_per_second",
            {
              description: "Frames per second for inbound RTP video",
            },
          ),
          framesReceived: meter.createCounter(
            "inbound_rtp_video_frames_received",
            {
              description: "Frames received for inbound RTP video",
            },
          ),
          freezeCount: meter.createCounter("inbound_rtp_video_freeze_count", {
            description: "Freeze count for inbound RTP video",
          }),
          headerBytesReceived: meter.createHistogram(
            "inbound_rtp_video_header_bytes_received",
            {
              description: "Header bytes received for inbound RTP video",
            },
          ),
          jitterBufferDelay: meter.createHistogram(
            "inbound_rtp_video_jitter_buffer_delay",
            {
              description: "Jitter buffer delay for inbound RTP video",
            },
          ),
          jitterBufferEmittedCount: meter.createCounter(
            "inbound_rtp_video_jitter_buffer_emitted_count",
            {
              description: "Jitter buffer emitted count for inbound RTP video",
            },
          ),
          jitterBufferMinimumDelay: meter.createHistogram(
            "inbound_rtp_video_jitter_buffer_minimum_delay",
            {
              description: "Jitter buffer minimum delay for inbound RTP video",
            },
          ),
          jitterBufferTargetDelay: meter.createHistogram(
            "inbound_rtp_video_jitter_buffer_target_delay",
            {
              description: "Jitter buffer target delay for inbound RTP video",
            },
          ),
          keyFramesDecoded: meter.createCounter(
            "inbound_rtp_video_key_frames_decoded",
            {
              description: "Key frames decoded for inbound RTP video",
            },
          ),
          lastPacketReceivedTimestamp: meter.createHistogram(
            "inbound_rtp_video_last_packet_received_timestamp",
            {
              description:
                "Last packet received timestamp for inbound RTP video",
            },
          ),
          mid: meter.createCounter("inbound_rtp_video_mid", {
            description: "MID for inbound RTP video",
          }),
          nackCount: meter.createCounter("inbound_rtp_video_nack_count", {
            description: "NACK count for inbound RTP video",
          }),
          pauseCount: meter.createCounter("inbound_rtp_video_pause_count", {
            description: "Pause count for inbound RTP video",
          }),
          pliCount: meter.createCounter("inbound_rtp_video_pli_count", {
            description: "PLI count for inbound RTP video",
          }),
          powerEfficientDecoder: meter.createGauge(
            "inbound_rtp_video_power_efficient_decoder",
            {
              description: "Power efficient decoder for inbound RTP video",
            },
          ),
          qpSum: meter.createCounter("inbound_rtp_video_qp_sum", {
            description: "QP sum for inbound RTP video",
          }),
          remoteId: meter.createCounter("inbound_rtp_video_remote_id", {
            description: "Remote ID for inbound RTP video",
          }),
          totalAssemblyTime: meter.createHistogram(
            "inbound_rtp_video_total_assembly_time",
            {
              description: "Total assembly time for inbound RTP video",
            },
          ),
          totalDecodeTime: meter.createHistogram(
            "inbound_rtp_video_total_decode_time",
            {
              description: "Total decode time for inbound RTP video",
            },
          ),
          totalFreezesDuration: meter.createHistogram(
            "inbound_rtp_video_total_freezes_duration",
            {
              description: "Total freezes duration for inbound RTP video",
            },
          ),
          totalInterFrameDelay: meter.createHistogram(
            "inbound_rtp_video_total_inter_frame_delay",
            {
              description: "Total inter frame delay for inbound RTP video",
            },
          ),
          totalPausesDuration: meter.createHistogram(
            "inbound_rtp_video_total_pauses_duration",
            {
              description: "Total pauses duration for inbound RTP video",
            },
          ),
          totalProcessingDelay: meter.createHistogram(
            "inbound_rtp_video_total_processing_delay",
            {
              description: "Total processing delay for inbound RTP video",
            },
          ),
          totalSquaredInterFrameDelay: meter.createHistogram(
            "inbound_rtp_video_total_squared_inter_frame_delay",
            {
              description:
                "Total squared inter frame delay for inbound RTP video",
            },
          ),
          trackIdentifier: meter.createCounter(
            "inbound_rtp_video_track_identifier",
            {
              description: "Track identifier for inbound RTP video",
            },
          ),
        };

        videoMetrics.decoderImplementation.record(
          stats.decoderImplementation || "",
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        videoMetrics.firCount.add(stats.firCount || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        videoMetrics.frameHeight.record(stats.frameHeight || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        videoMetrics.frameWidth.record(stats.frameWidth || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        videoMetrics.framesAssembledFromMultiplePackets.add(
          stats.framesAssembledFromMultiplePackets || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        videoMetrics.framesDecoded.add(stats.framesDecoded || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        videoMetrics.framesDropped.add(stats.framesDropped || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        videoMetrics.framesPerSecond.record(stats.framesPerSecond || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        videoMetrics.framesReceived.add(stats.framesReceived || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        videoMetrics.freezeCount.add(stats.freezeCount || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        videoMetrics.headerBytesReceived.record(
          stats.headerBytesReceived || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        videoMetrics.jitterBufferDelay.record(stats.jitterBufferDelay || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        videoMetrics.jitterBufferEmittedCount.add(
          stats.jitterBufferEmittedCount || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        videoMetrics.jitterBufferMinimumDelay.record(
          stats.jitterBufferMinimumDelay || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        videoMetrics.jitterBufferTargetDelay.record(
          stats.jitterBufferTargetDelay || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        videoMetrics.keyFramesDecoded.add(stats.keyFramesDecoded || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        videoMetrics.lastPacketReceivedTimestamp.record(
          stats.lastPacketReceivedTimestamp || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        videoMetrics.mid.add(stats.mid || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        videoMetrics.nackCount.add(stats.nackCount || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        videoMetrics.pauseCount.add(stats.pauseCount || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        videoMetrics.pliCount.add(stats.pliCount || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        videoMetrics.powerEfficientDecoder.record(
          stats.powerEfficientDecoder || false,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        videoMetrics.qpSum.add(stats.qpSum || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        videoMetrics.remoteId.add(stats.remoteId || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        videoMetrics.totalAssemblyTime.record(stats.totalAssemblyTime || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        videoMetrics.totalDecodeTime.record(stats.totalDecodeTime || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        videoMetrics.totalFreezesDuration.record(
          stats.totalFreezesDuration || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        videoMetrics.totalInterFrameDelay.record(
          stats.totalInterFrameDelay || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        videoMetrics.totalPausesDuration.record(
          stats.totalPausesDuration || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        videoMetrics.totalProcessingDelay.record(
          stats.totalProcessingDelay || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        videoMetrics.totalSquaredInterFrameDelay.record(
          stats.totalSquaredInterFrameDelay || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        videoMetrics.trackIdentifier.add(stats.trackIdentifier || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
      } else if (trackType === "allTracks") {
        const allTracksMetrics = {
          bytesReceived: meter.createHistogram(
            "inbound_rtp_all_tracks_bytes_received",
            {
              description: "Bytes received for inbound RTP all tracks",
            },
          ),
          packetsReceived: meter.createCounter(
            "inbound_rtp_all_tracks_packets_received",
            {
              description: "Packets received for inbound RTP all tracks",
            },
          ),
          jitter: meter.createGauge("inbound_rtp_all_tracks_jitter", {
            description: "Jitter for inbound RTP all tracks",
          }),
          packetsLost: meter.createCounter(
            "inbound_rtp_all_tracks_packets_lost",
            {
              description: "Packets lost for inbound RTP all tracks",
            },
          ),
          headerBytesReceived: meter.createHistogram(
            "inbound_rtp_all_tracks_header_bytes_received",
            {
              description: "Header bytes received for inbound RTP all tracks",
            },
          ),
          jitterBufferDelay: meter.createHistogram(
            "inbound_rtp_all_tracks_jitter_buffer_delay",
            {
              description: "Jitter buffer delay for inbound RTP all tracks",
            },
          ),
          jitterBufferEmittedCount: meter.createCounter(
            "inbound_rtp_all_tracks_jitter_buffer_emitted_count",
            {
              description:
                "Jitter buffer emitted count for inbound RTP all tracks",
            },
          ),
          jitterBufferMinimumDelay: meter.createHistogram(
            "inbound_rtp_all_tracks_jitter_buffer_minimum_delay",
            {
              description:
                "Jitter buffer minimum delay for inbound RTP all tracks",
            },
          ),
          jitterBufferTargetDelay: meter.createHistogram(
            "inbound_rtp_all_tracks_jitter_buffer_target_delay",
            {
              description:
                "Jitter buffer target delay for inbound RTP all tracks",
            },
          ),
          lastPacketReceivedTimestamp: meter.createHistogram(
            "inbound_rtp_all_tracks_last_packet_received_timestamp",
            {
              description:
                "Last packet received timestamp for inbound RTP all tracks",
            },
          ),
          nackCount: meter.createCounter("inbound_rtp_all_tracks_nack_count", {
            description: "NACK count for inbound RTP all tracks",
          }),
          packetsDiscarded: meter.createCounter(
            "inbound_rtp_all_tracks_packets_discarded",
            {
              description: "Packets discarded for inbound RTP all tracks",
            },
          ),
          playoutId: meter.createCounter("inbound_rtp_all_tracks_playout_id", {
            description: "Playout ID for inbound RTP all tracks",
          }),
          totalAudioEnergy: meter.createHistogram(
            "inbound_rtp_all_tracks_total_audio_energy",
            {
              description: "Total audio energy for inbound RTP all tracks",
            },
          ),
          totalSamplesDuration: meter.createHistogram(
            "inbound_rtp_all_tracks_total_samples_duration",
            {
              description: "Total samples duration for inbound RTP all tracks",
            },
          ),
          totalSamplesReceived: meter.createCounter(
            "inbound_rtp_all_tracks_total_samples_received",
            {
              description: "Total samples received for inbound RTP all tracks",
            },
          ),
        };

        allTracksMetrics.bytesReceived.record(stats.bytesReceived || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        allTracksMetrics.packetsReceived.add(stats.packetsReceived || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        allTracksMetrics.jitter.record(stats.jitter || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        allTracksMetrics.packetsLost.add(stats.packetsLost || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        allTracksMetrics.headerBytesReceived.record(
          stats.headerBytesReceived || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        allTracksMetrics.jitterBufferDelay.record(
          stats.jitterBufferDelay || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        allTracksMetrics.jitterBufferEmittedCount.add(
          stats.jitterBufferEmittedCount || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        allTracksMetrics.jitterBufferMinimumDelay.record(
          stats.jitterBufferMinimumDelay || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        allTracksMetrics.jitterBufferTargetDelay.record(
          stats.jitterBufferTargetDelay || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        allTracksMetrics.lastPacketReceivedTimestamp.record(
          stats.lastPacketReceivedTimestamp || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        allTracksMetrics.nackCount.add(stats.nackCount || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        allTracksMetrics.packetsDiscarded.add(stats.packetsDiscarded || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        allTracksMetrics.playoutId.add(stats.playoutId || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        allTracksMetrics.totalAudioEnergy.record(stats.totalAudioEnergy || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        allTracksMetrics.totalSamplesDuration.record(
          stats.totalSamplesDuration || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        allTracksMetrics.totalSamplesReceived.add(
          stats.totalSamplesReceived || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
      }
      break;
    case "media-playout":
      const mediaPlayoutMetrics = {
        synthesizedSamplesDuration: meter.createHistogram(
          "media_playout_synthesized_samples_duration",
          {
            description: "Synthesized samples duration for media playout",
          },
        ),
        synthesizedSamplesEvents: meter.createCounter(
          "media_playout_synthesized_samples_events",
          {
            description: "Synthesized samples events for media playout",
          },
        ),
        totalPlayoutDelay: meter.createHistogram(
          "media_playout_total_playout_delay",
          {
            description: "Total playout delay for media playout",
          },
        ),
        totalSamplesCount: meter.createCounter(
          "media_playout_total_samples_count",
          {
            description: "Total samples count for media playout",
          },
        ),
        totalSamplesDuration: meter.createHistogram(
          "media_playout_total_samples_duration",
          {
            description: "Total samples duration for media playout",
          },
        ),
      };
      mediaPlayoutMetrics.synthesizedSamplesDuration.record(
        stats.synthesizedSamplesDuration || 0,
        {
          participant: participantName,
          trackType,
          roomName,
        },
      );
      mediaPlayoutMetrics.synthesizedSamplesEvents.add(
        stats.synthesizedSamplesEvents || 0,
        {
          participant: participantName,
          trackType,
          roomName,
        },
      );
      mediaPlayoutMetrics.totalPlayoutDelay.record(
        stats.totalPlayoutDelay || 0,
        {
          participant: participantName,
          trackType,
          roomName,
        },
      );
      mediaPlayoutMetrics.totalSamplesCount.add(stats.totalSamplesCount || 0, {
        participant: participantName,
        trackType,
        roomName,
      });
      mediaPlayoutMetrics.totalSamplesDuration.record(
        stats.totalSamplesDuration || 0,
        {
          participant: participantName,
          trackType,
          roomName,
        },
      );
      break;
    case "remote-outbound-rtp":
      const remoteOutboundRtpMetrics = {
        bytesSent: meter.createHistogram("remote_outbound_rtp_bytes_sent", {
          description: "Bytes sent for remote outbound RTP",
        }),
        packetsSent: meter.createCounter("remote_outbound_rtp_packets_sent", {
          description: "Packets sent for remote outbound RTP",
        }),
        totalRoundTripTime: meter.createHistogram(
          "remote_outbound_rtp_total_round_trip_time",
          {
            description: "Total round trip time for remote outbound RTP",
          },
        ),
        roundTripTimeMeasurements: meter.createCounter(
          "remote_outbound_rtp_round_trip_time_measurements",
          {
            description: "Round trip time measurements for remote outbound RTP",
          },
        ),
        reportsSent: meter.createCounter("remote_outbound_rtp_reports_sent", {
          description: "Reports sent for remote outbound RTP",
        }),
      };

      remoteOutboundRtpMetrics.bytesSent.record(stats.bytesSent || 0, {
        participant: participantName,
        trackType,
        roomName,
      });
      remoteOutboundRtpMetrics.packetsSent.add(stats.packetsSent || 0, {
        participant: participantName,
        trackType,
        roomName,
      });
      remoteOutboundRtpMetrics.totalRoundTripTime.record(
        stats.totalRoundTripTime || 0,
        { participant: participantName, trackType, roomName },
      );
      remoteOutboundRtpMetrics.roundTripTimeMeasurements.add(
        stats.roundTripTimeMeasurements || 0,
        { participant: participantName, trackType, roomName },
      );
      remoteOutboundRtpMetrics.reportsSent.add(stats.reportsSent || 0, {
        participant: participantName,
        trackType,
        roomName,
      });
      break;
    case "remote-inbound-rtp":
      const remoteInboundRtpMetrics = {
        jitter: meter.createGauge("remote_inbound_rtp_jitter", {
          description: "Jitter for remote inbound RTP",
        }),
        packetsLost: meter.createCounter("remote_inbound_rtp_packets_lost", {
          description: "Packets lost for remote inbound RTP",
        }),
        fractionLost: meter.createGauge("remote_inbound_rtp_fraction_lost", {
          description: "Fraction lost for remote inbound RTP",
        }),
        roundTripTime: meter.createHistogram(
          "remote_inbound_rtp_round_trip_time",
          {
            description: "Round trip time for remote inbound RTP",
          },
        ),
        roundTripTimeMeasurements: meter.createCounter(
          "remote_inbound_rtp_round_trip_time_measurements",
          {
            description: "Round trip time measurements for remote inbound RTP",
          },
        ),
        totalRoundTripTime: meter.createHistogram(
          "remote_inbound_rtp_total_round_trip_time",
          {
            description: "Total round trip time for remote inbound RTP",
          },
        ),
      };

      remoteInboundRtpMetrics.jitter.record(stats.jitter || 0, {
        participant: participantName,
        trackType,
        roomName,
      });
      remoteInboundRtpMetrics.packetsLost.add(stats.packetsLost || 0, {
        participant: participantName,
        trackType,
        roomName,
      });
      remoteInboundRtpMetrics.fractionLost.record(stats.fractionLost || 0, {
        participant: participantName,
        trackType,
        roomName,
      });
      remoteInboundRtpMetrics.roundTripTime.record(stats.roundTripTime || 0, {
        participant: participantName,
        trackType,
        roomName,
      });
      remoteInboundRtpMetrics.roundTripTimeMeasurements.add(
        stats.roundTripTimeMeasurements || 0,
        {
          participant: participantName,
          trackType,
          roomName,
        },
      );
      remoteInboundRtpMetrics.totalRoundTripTime.record(
        stats.totalRoundTripTime || 0,
        {
          participant: participantName,
          trackType,
          roomName,
        },
      );
      break;

    case "media-source":
      if (trackType === "audio") {
        const mediaSourceAudioMetrics = {
          audioLevel: meter.createGauge("media_source_audio_level", {
            description: "Audio level for media source audio",
          }),
          echoReturnLoss: meter.createGauge("media_source_echo_return_loss", {
            description: "Echo return loss for media source audio",
          }),
          echoReturnLossEnhancement: meter.createGauge(
            "media_source_echo_return_loss_enhancement",
            {
              description:
                "Echo return loss enhancement for media source audio",
            },
          ),
          totalAudioEnergy: meter.createHistogram(
            "media_source_total_audio_energy",
            {
              description: "Total audio energy for media source audio",
            },
          ),
          totalSamplesDuration: meter.createHistogram(
            "media_source_total_samples_duration",
            {
              description: "Total samples duration for media source audio",
            },
          ),
        };
        mediaSourceAudioMetrics.audioLevel.record(stats.audioLevel || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        mediaSourceAudioMetrics.echoReturnLoss.record(
          stats.echoReturnLoss || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        mediaSourceAudioMetrics.echoReturnLossEnhancement.record(
          stats.echoReturnLossEnhancement || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        mediaSourceAudioMetrics.totalAudioEnergy.record(
          stats.totalAudioEnergy || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        mediaSourceAudioMetrics.totalSamplesDuration.record(
          stats.totalSamplesDuration || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
      } else if (trackType === "video") {
        const mediaSourceVideoMetrics = {
          frames: meter.createCounter("media_source_video_frames", {
            description: "Frames for media source video",
          }),
          framesPerSecond: meter.createGauge(
            "media_source_video_frames_per_second",
            {
              description: "Frames per second for media source video",
            },
          ),
          height: meter.createGauge("media_source_video_height", {
            description: "Height for media source video",
          }),
          width: meter.createGauge("media_source_video_width", {
            description: "Width for media source video",
          }),
        };
        mediaSourceVideoMetrics.frames.add(stats.frames || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        mediaSourceVideoMetrics.framesPerSecond.record(
          stats.framesPerSecond || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        mediaSourceVideoMetrics.height.record(stats.height || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        mediaSourceVideoMetrics.width.record(stats.width || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
      } else if (trackType === "allTracks") {
        const mediaSourceAllTracksMetrics = {
          audioLevel: meter.createGauge("media_source_all_tracks_audio_level", {
            description: "Audio level for media source all tracks",
          }),
          echoReturnLoss: meter.createGauge(
            "media_source_all_tracks_echo_return_loss",
            {
              description: "Echo return loss for media source all tracks",
            },
          ),
          echoReturnLossEnhancement: meter.createGauge(
            "media_source_all_tracks_echo_return_loss_enhancement",
            {
              description:
                "Echo return loss enhancement for media source all tracks",
            },
          ),
          totalAudioEnergy: meter.createHistogram(
            "media_source_all_tracks_total_audio_energy",
            {
              description: "Total audio energy for media source all tracks",
            },
          ),
          totalSamplesDuration: meter.createHistogram(
            "media_source_all_tracks_total_samples_duration",
            {
              description: "Total samples duration for media source all tracks",
            },
          ),
        };
        mediaSourceAllTracksMetrics.audioLevel.record(stats.audioLevel || 0, {
          participant: participantName,
          trackType,
          roomName,
        });
        mediaSourceAllTracksMetrics.echoReturnLoss.record(
          stats.echoReturnLoss || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        mediaSourceAllTracksMetrics.echoReturnLossEnhancement.record(
          stats.echoReturnLossEnhancement || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        mediaSourceAllTracksMetrics.totalAudioEnergy.record(
          stats.totalAudioEnergy || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
        mediaSourceAllTracksMetrics.totalSamplesDuration.record(
          stats.totalSamplesDuration || 0,
          {
            participant: participantName,
            trackType,
            roomName,
          },
        );
      }
      break;

    case "candidate-pair":
      const candidatePairMetrics = {
        bytesReceived: meter.createHistogram("candidate_pair_bytes_received", {
          description: "Bytes received for candidate pair",
        }),
        bytesSent: meter.createHistogram("candidate_pair_bytes_sent", {
          description: "Bytes sent for candidate pair",
        }),
        packetsReceived: meter.createCounter(
          "candidate_pair_packets_received",
          {
            description: "Packets received for candidate pair",
          },
        ),
        packetsSent: meter.createCounter("candidate_pair_packets_sent", {
          description: "Packets sent for candidate pair",
        }),
        currentRoundTripTime: meter.createGauge("candidate_pair_current_rtt", {
          description: "Current round trip time for candidate pair",
        }),
        totalRoundTripTime: meter.createHistogram("candidate_pair_total_rtt", {
          description: "Total round trip time for candidate pair",
        }),
      };
      candidatePairMetrics.bytesReceived.record(stats.bytesReceived || 0, {
        participant: participantName,
        trackType,
        roomName,
      });
      candidatePairMetrics.bytesSent.record(stats.bytesSent || 0, {
        participant: participantName,
        trackType,
        roomName,
      });
      candidatePairMetrics.packetsReceived.add(stats.packetsReceived || 0, {
        participant: participantName,
        trackType,
        roomName,
      });
      candidatePairMetrics.packetsSent.add(stats.packetsSent || 0, {
        participant: participantName,
        trackType,
        roomName,
      });
      candidatePairMetrics.currentRoundTripTime.record(
        stats.currentRoundTripTime || 0,
        {
          participant: participantName,
          trackType,
          roomName,
        },
      );
      candidatePairMetrics.totalRoundTripTime.record(
        stats.totalRoundTripTime || 0,
        {
          participant: participantName,
          trackType,
          roomName,
        },
      );
      break;
  }
}
