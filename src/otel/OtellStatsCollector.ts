import {
  Room,
  RemoteParticipant,
  LocalParticipant,
  LocalTrackPublication,
  RemoteTrackPublication,
} from "livekit-client";
import { logger } from "matrix-js-sdk/src/logger";
import { ElementCallOpenTelemetry } from "./otel";
import { BatchObservableCallback } from "@opentelemetry/api";

// Function to extract the participant's name
export function extractNameFromIdentity(identity: string): string {
  const match = identity.match(/^@([^\:]+):/);
  return match ? match[1] : identity;
}

// Function to process tracks for a participant
export async function otelCollectMetricsRtcStats(livekitRoom: Room) {
  while (true) {
    await collectStatsFromRoom(livekitRoom);
    await new Promise((resolve) => setTimeout(resolve, 40000));
  }
}

async function processTrackStats(
  participant: LocalParticipant | RemoteParticipant,
  trackPublication: LocalTrackPublication | RemoteTrackPublication,
  livekitRoom: Room,
) {
  const statsReport = await trackPublication.track?.getRTCStatsReport();
  if (statsReport) {
    for (const stats of statsReport.values()) {
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
        logger.info(
          "type",
          stats.type,
          `For ${extractNameFromIdentity(participant.identity)} track statsReport.values():`,
          stats,
        );
        await sendRtcStatsTrace(
          stats,
          stats.type,
          participant,
          trackPublication,
          trackPublication.kind,
          livekitRoom.name,
        );
        await sendRtcStatsMetric(
          stats,
          stats.type,
          participant,
          trackPublication.kind,
          livekitRoom.name,
        );
      }
    }
  } else {
    logger.info(
      `No stats available for ${extractNameFromIdentity(participant.identity)}, Track ${trackPublication.trackSid}.`,
    );
  }
}

async function collectStatsForParticipant(
  participant: LocalParticipant | RemoteParticipant,
  livekitRoom: Room,
) {
  for (const audioTrackPublication of participant.audioTrackPublications.values()) {
    await processTrackStats(participant, audioTrackPublication, livekitRoom);
  }

  for (const videoTrackPublication of participant.videoTrackPublications.values()) {
    await processTrackStats(participant, videoTrackPublication, livekitRoom);
  }
}

async function collectStatsFromRoom(livekitRoom: Room) {
  // Log stats for local participant
  await collectStatsForParticipant(livekitRoom.localParticipant, livekitRoom);

  // Does not work with async iterator
  // Log stats for each remote participant
  // for (const remoteParticipant of livekitRoom.remoteParticipants.values()) {
  //   await collectStatsForParticipant(remoteParticipant, livekitRoom);
  // }
}

export async function sendRtcStatsMetric(
  stats: any,
  statType: string,
  participant: RemoteParticipant | LocalParticipant,
  trackType: string,
  roomName: string,
): Promise<void> {
  // Get the meter provider and meter
  const meterProvider = ElementCallOpenTelemetry.instance.meterProvider;
  const meter = meterProvider.getMeter("element-call");
  const participantName = extractNameFromIdentity(participant.identity);

  const attributes = { participant: participantName, trackType, roomName };

  // Process metrics based on stat type
  switch (statType) {
    case "codec":
      if (trackType === "audio") {
        const codecAudioClockRate = meter.createObservableGauge(
          "codec_audio_clock_rate",
          {
            description: "Clock rate of the audio codec",
          },
        );
        const codecAudioChannels = meter.createObservableGauge(
          "codec_audio_channels",
          {
            description: "Channels of the audio codec",
          },
        );
        const codecAudioMimeType = meter.createObservableCounter(
          "codec_audio_mime_type_count",
          {
            description: "Count of MIME types of the audio codec",
          },
        );
        const codecAudioSdpFmtpLine = meter.createObservableCounter(
          "codec_audio_sdp_fmtp_line_count",
          {
            description: "Count of SDP fmtp lines of the audio codec",
          },
        );

        const observableCallback: BatchObservableCallback = (
          observableRegistry,
        ) => {
          observableRegistry.observe(
            codecAudioClockRate,
            stats.clockRate || 0,
            attributes,
          );
          observableRegistry.observe(
            codecAudioChannels,
            stats.channels || 0,
            attributes,
          );
          observableRegistry.observe(codecAudioMimeType, 1, {
            ...attributes,
            mimeType: stats.mimeType || "",
          });
          observableRegistry.observe(codecAudioSdpFmtpLine, 1, {
            ...attributes,
            sdpFmtpLine: stats.sdpFmtpLine || "",
          });
        };

        meter.addBatchObservableCallback(observableCallback, [
          codecAudioClockRate,
          codecAudioChannels,
          codecAudioMimeType,
          codecAudioSdpFmtpLine,
        ]);
      } else if (trackType === "video") {
        const codecVideoClockRate = meter.createObservableGauge(
          "codec_video_clock_rate",
          {
            description: "Clock rate of the video codec",
          },
        );
        const codecVideoMimeType = meter.createObservableCounter(
          "codec_video_mime_type_count",
          {
            description: "Count of MIME types of the video codec",
          },
        );
        const codecVideoSdpFmtpLine = meter.createObservableCounter(
          "codec_video_sdp_fmtp_line_count",
          {
            description: "Count of SDP fmtp lines of the video codec",
          },
        );

        const observableCallback: BatchObservableCallback = (
          observableRegistry,
        ) => {
          observableRegistry.observe(
            codecVideoClockRate,
            stats.clockRate || 0,
            attributes,
          );
          observableRegistry.observe(codecVideoMimeType, 1, {
            ...attributes,
            mimeType: stats.mimeType || "",
          });
          observableRegistry.observe(codecVideoSdpFmtpLine, 1, {
            ...attributes,
            sdpFmtpLine: stats.sdpFmtpLine || "",
          });
        };

        meter.addBatchObservableCallback(observableCallback, [
          codecVideoClockRate,
          codecVideoMimeType,
          codecVideoSdpFmtpLine,
        ]);
      }
      break;

    case "outbound-rtp":
      if (trackType === "audio") {
        const outboundRtpAudioBytesSent = meter.createObservableGauge(
          "outbound_rtp_audio_bytes_sent",
          {
            description: "Bytes sent for outbound RTP audio",
          },
        );
        const outboundRtpAudioPacketsSent = meter.createObservableCounter(
          "outbound_rtp_audio_packets_sent",
          {
            description: "Packets sent for outbound RTP audio",
          },
        );
        const outboundRtpAudioTargetBitrate = meter.createObservableGauge(
          "outbound_rtp_audio_target_bitrate",
          {
            description: "Target bitrate for outbound RTP audio",
          },
        );
        const outboundRtpAudioHeaderBytesSent = meter.createObservableGauge(
          "outbound_rtp_audio_header_bytes_sent",
          {
            description: "Header bytes sent for outbound RTP audio",
          },
        );
        const outboundRtpAudioNackCount = meter.createObservableCounter(
          "outbound_rtp_audio_nack_count",
          {
            description: "NACK count for outbound RTP audio",
          },
        );
        const outboundRtpAudioRetransmittedBytesSent =
          meter.createObservableGauge(
            "outbound_rtp_audio_retransmitted_bytes_sent",
            {
              description: "Retransmitted bytes sent for outbound RTP audio",
            },
          );
        const outboundRtpAudioRetransmittedPacketsSent =
          meter.createObservableCounter(
            "outbound_rtp_audio_retransmitted_packets_sent",
            {
              description: "Retransmitted packets sent for outbound RTP audio",
            },
          );
        const outboundRtpAudioTotalPacketSendDelay =
          meter.createObservableGauge(
            "outbound_rtp_audio_total_packet_send_delay",
            {
              description: "Total packet send delay for outbound RTP audio",
            },
          );

        const observableCallback: BatchObservableCallback = (
          observableRegistry,
        ) => {
          observableRegistry.observe(
            outboundRtpAudioBytesSent,
            stats.bytesSent || 0,
            attributes,
          );
          observableRegistry.observe(
            outboundRtpAudioPacketsSent,
            stats.packetsSent || 0,
            attributes,
          );
          observableRegistry.observe(
            outboundRtpAudioTargetBitrate,
            stats.targetBitrate || 0,
            attributes,
          );
          observableRegistry.observe(
            outboundRtpAudioHeaderBytesSent,
            stats.headerBytesSent || 0,
            attributes,
          );
          observableRegistry.observe(
            outboundRtpAudioNackCount,
            stats.nackCount || 0,
            attributes,
          );
          observableRegistry.observe(
            outboundRtpAudioRetransmittedBytesSent,
            stats.retransmittedBytesSent || 0,
            attributes,
          );
          observableRegistry.observe(
            outboundRtpAudioRetransmittedPacketsSent,
            stats.retransmittedPacketsSent || 0,
            attributes,
          );
          observableRegistry.observe(
            outboundRtpAudioTotalPacketSendDelay,
            stats.totalPacketSendDelay || 0,
            attributes,
          );
        };

        meter.addBatchObservableCallback(observableCallback, [
          outboundRtpAudioBytesSent,
          outboundRtpAudioPacketsSent,
          outboundRtpAudioTargetBitrate,
          outboundRtpAudioHeaderBytesSent,
          outboundRtpAudioNackCount,
          outboundRtpAudioRetransmittedBytesSent,
          outboundRtpAudioRetransmittedPacketsSent,
          outboundRtpAudioTotalPacketSendDelay,
        ]);
      } else if (trackType === "video") {
        const outboundRtpVideoBytesSent = meter.createObservableGauge(
          "outbound_rtp_video_bytes_sent",
          {
            description: "Bytes sent for outbound RTP video",
          },
        );
        const outboundRtpVideoPacketsSent = meter.createObservableCounter(
          "outbound_rtp_video_packets_sent",
          {
            description: "Packets sent for outbound RTP video",
          },
        );
        const outboundRtpVideoTargetBitrate = meter.createObservableGauge(
          "outbound_rtp_video_target_bitrate",
          {
            description: "Target bitrate for outbound RTP video",
          },
        );
        const outboundRtpVideoHeaderBytesSent = meter.createObservableGauge(
          "outbound_rtp_video_header_bytes_sent",
          {
            description: "Header bytes sent for outbound RTP video",
          },
        );
        const outboundRtpVideoNackCount = meter.createObservableCounter(
          "outbound_rtp_video_nack_count",
          {
            description: "NACK count for outbound RTP video",
          },
        );
        const outboundRtpVideoRetransmittedBytesSent =
          meter.createObservableGauge(
            "outbound_rtp_video_retransmitted_bytes_sent",
            {
              description: "Retransmitted bytes sent for outbound RTP video",
            },
          );
        const outboundRtpVideoRetransmittedPacketsSent =
          meter.createObservableCounter(
            "outbound_rtp_video_retransmitted_packets_sent",
            {
              description: "Retransmitted packets sent for outbound RTP video",
            },
          );
        const outboundRtpVideoTotalPacketSendDelay =
          meter.createObservableGauge(
            "outbound_rtp_video_total_packet_send_delay",
            {
              description: "Total packet send delay for outbound RTP video",
            },
          );
        const outboundRtpVideoFrameHeight = meter.createObservableGauge(
          "outbound_rtp_video_frame_height",
          {
            description: "Frame height for outbound RTP video",
          },
        );
        const outboundRtpVideoFrameWidth = meter.createObservableGauge(
          "outbound_rtp_video_frame_width",
          {
            description: "Frame width for outbound RTP video",
          },
        );
        const outboundRtpVideoFramesEncoded = meter.createObservableCounter(
          "outbound_rtp_video_frames_encoded",
          {
            description: "Frames encoded for outbound RTP video",
          },
        );
        const outboundRtpVideoFramesPerSecond = meter.createObservableGauge(
          "outbound_rtp_video_frames_per_second",
          {
            description: "Frames per second for outbound RTP video",
          },
        );
        const outboundRtpVideoFramesSent = meter.createObservableCounter(
          "outbound_rtp_video_frames_sent",
          {
            description: "Frames sent for outbound RTP video",
          },
        );
        const outboundRtpVideoKeyFramesEncoded = meter.createObservableCounter(
          "outbound_rtp_video_key_frames_encoded",
          {
            description: "Key frames encoded for outbound RTP video",
          },
        );
        const outboundRtpVideoTotalEncodeTime = meter.createObservableGauge(
          "outbound_rtp_video_total_encode_time",
          {
            description: "Total encode time for outbound RTP video",
          },
        );

        const observableCallback: BatchObservableCallback = (
          observableRegistry,
        ) => {
          observableRegistry.observe(
            outboundRtpVideoBytesSent,
            stats.bytesSent || 0,
            attributes,
          );
          observableRegistry.observe(
            outboundRtpVideoPacketsSent,
            stats.packetsSent || 0,
            attributes,
          );
          observableRegistry.observe(
            outboundRtpVideoTargetBitrate,
            stats.targetBitrate || 0,
            attributes,
          );
          observableRegistry.observe(
            outboundRtpVideoHeaderBytesSent,
            stats.headerBytesSent || 0,
            attributes,
          );
          observableRegistry.observe(
            outboundRtpVideoNackCount,
            stats.nackCount || 0,
            attributes,
          );
          observableRegistry.observe(
            outboundRtpVideoRetransmittedBytesSent,
            stats.retransmittedBytesSent || 0,
            attributes,
          );
          observableRegistry.observe(
            outboundRtpVideoRetransmittedPacketsSent,
            stats.retransmittedPacketsSent || 0,
            attributes,
          );
          observableRegistry.observe(
            outboundRtpVideoTotalPacketSendDelay,
            stats.totalPacketSendDelay || 0,
            attributes,
          );
          observableRegistry.observe(
            outboundRtpVideoFrameHeight,
            stats.frameHeight || 0,
            attributes,
          );
          observableRegistry.observe(
            outboundRtpVideoFrameWidth,
            stats.frameWidth || 0,
            attributes,
          );
          observableRegistry.observe(
            outboundRtpVideoFramesEncoded,
            stats.framesEncoded || 0,
            attributes,
          );
          observableRegistry.observe(
            outboundRtpVideoFramesPerSecond,
            stats.framesPerSecond || 0,
            attributes,
          );
          observableRegistry.observe(
            outboundRtpVideoFramesSent,
            stats.framesSent || 0,
            attributes,
          );
          observableRegistry.observe(
            outboundRtpVideoKeyFramesEncoded,
            stats.keyFramesEncoded || 0,
            attributes,
          );
          observableRegistry.observe(
            outboundRtpVideoTotalEncodeTime,
            stats.totalEncodeTime || 0,
            attributes,
          );
        };

        meter.addBatchObservableCallback(observableCallback, [
          outboundRtpVideoBytesSent,
          outboundRtpVideoPacketsSent,
          outboundRtpVideoTargetBitrate,
          outboundRtpVideoHeaderBytesSent,
          outboundRtpVideoNackCount,
          outboundRtpVideoRetransmittedBytesSent,
          outboundRtpVideoRetransmittedPacketsSent,
          outboundRtpVideoTotalPacketSendDelay,
          outboundRtpVideoFrameHeight,
          outboundRtpVideoFrameWidth,
          outboundRtpVideoFramesEncoded,
          outboundRtpVideoFramesPerSecond,
          outboundRtpVideoFramesSent,
          outboundRtpVideoKeyFramesEncoded,
          outboundRtpVideoTotalEncodeTime,
        ]);
      }
      break;

    case "inbound-rtp":
      if (trackType === "audio") {
        const inboundRtpAudioBytesReceived = meter.createObservableGauge(
          "inbound_rtp_audio_bytes_received",
          {
            description: "Bytes received for inbound RTP audio",
          },
        );
        const inboundRtpAudioPacketsReceived = meter.createObservableCounter(
          "inbound_rtp_audio_packets_received",
          {
            description: "Packets received for inbound RTP audio",
          },
        );
        const inboundRtpAudioJitter = meter.createObservableGauge(
          "inbound_rtp_audio_jitter",
          {
            description: "Jitter for inbound RTP audio",
          },
        );
        const inboundRtpAudioPacketsLost = meter.createObservableCounter(
          "inbound_rtp_audio_packets_lost",
          {
            description: "Packets lost for inbound RTP audio",
          },
        );
        const inboundRtpAudioLevel = meter.createObservableGauge(
          "inbound_rtp_audio_level",
          {
            description: "Audio level for inbound RTP audio",
          },
        );
        const inboundRtpAudioConcealedSamples = meter.createObservableCounter(
          "inbound_rtp_audio_concealed_samples",
          {
            description: "Concealed samples for inbound RTP audio",
          },
        );
        const inboundRtpAudioConcealmentEvents = meter.createObservableCounter(
          "inbound_rtp_audio_concealment_events",
          {
            description: "Concealment events for inbound RTP audio",
          },
        );
        const inboundRtpAudioFecPacketsDiscarded =
          meter.createObservableCounter(
            "inbound_rtp_audio_fec_packets_discarded",
            {
              description: "FEC packets discarded for inbound RTP audio",
            },
          );
        const inboundRtpAudioFecPacketsReceived = meter.createObservableCounter(
          "inbound_rtp_audio_fec_packets_received",
          {
            description: "FEC packets received for inbound RTP audio",
          },
        );
        const inboundRtpAudioHeaderBytesReceived = meter.createObservableGauge(
          "inbound_rtp_audio_header_bytes_received",
          {
            description: "Header bytes received for inbound RTP audio",
          },
        );
        const inboundRtpAudioInsertedSamplesForDeceleration =
          meter.createObservableCounter(
            "inbound_rtp_audio_inserted_samples_for_deceleration",
            {
              description:
                "Inserted samples for deceleration for inbound RTP audio",
            },
          );
        const inboundRtpAudioJitterBufferDelay = meter.createObservableGauge(
          "inbound_rtp_audio_jitter_buffer_delay",
          {
            description: "Jitter buffer delay for inbound RTP audio",
          },
        );
        const inboundRtpAudioJitterBufferEmittedCount =
          meter.createObservableCounter(
            "inbound_rtp_audio_jitter_buffer_emitted_count",
            {
              description: "Jitter buffer emitted count for inbound RTP audio",
            },
          );
        const inboundRtpAudioJitterBufferMinimumDelay =
          meter.createObservableGauge(
            "inbound_rtp_audio_jitter_buffer_minimum_delay",
            {
              description: "Jitter buffer minimum delay for inbound RTP audio",
            },
          );
        const inboundRtpAudioJitterBufferTargetDelay =
          meter.createObservableGauge(
            "inbound_rtp_audio_jitter_buffer_target_delay",
            {
              description: "Jitter buffer target delay for inbound RTP audio",
            },
          );
        const inboundRtpAudioLastPacketReceivedTimestamp =
          meter.createObservableGauge(
            "inbound_rtp_audio_last_packet_received_timestamp",
            {
              description:
                "Last packet received timestamp for inbound RTP audio",
            },
          );
        const inboundRtpAudioNackCount = meter.createObservableCounter(
          "inbound_rtp_audio_nack_count",
          {
            description: "NACK count for inbound RTP audio",
          },
        );
        const inboundRtpAudioPacketsDiscarded = meter.createObservableCounter(
          "inbound_rtp_audio_packets_discarded",
          {
            description: "Packets discarded for inbound RTP audio",
          },
        );
        const inboundRtpAudioPlayoutId = meter.createObservableCounter(
          "inbound_rtp_audio_playout_id",
          {
            description: "Playout ID for inbound RTP audio",
          },
        );
        const inboundRtpAudioRemovedSamplesForAcceleration =
          meter.createObservableCounter(
            "inbound_rtp_audio_removed_samples_for_acceleration",
            {
              description:
                "Removed samples for acceleration for inbound RTP audio",
            },
          );
        const inboundRtpAudioSilentConcealedSamples =
          meter.createObservableCounter(
            "inbound_rtp_audio_silent_concealed_samples",
            {
              description: "Silent concealed samples for inbound RTP audio",
            },
          );
        const inboundRtpAudioTotalAudioEnergy = meter.createObservableGauge(
          "inbound_rtp_audio_total_audio_energy",
          {
            description: "Total audio energy for inbound RTP audio",
          },
        );
        const inboundRtpAudioTotalSamplesDuration = meter.createObservableGauge(
          "inbound_rtp_audio_total_samples_duration",
          {
            description: "Total samples duration for inbound RTP audio",
          },
        );
        const inboundRtpAudioTotalSamplesReceived =
          meter.createObservableCounter(
            "inbound_rtp_audio_total_samples_received",
            {
              description: "Total samples received for inbound RTP audio",
            },
          );
        const inboundRtpAudioTrackIdentifier = meter.createObservableCounter(
          "inbound_rtp_audio_track_identifier",
          {
            description: "Track identifier for inbound RTP audio",
          },
        );

        const observableCallback: BatchObservableCallback = (
          observableRegistry,
        ) => {
          observableRegistry.observe(
            inboundRtpAudioBytesReceived,
            stats.bytesReceived || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpAudioPacketsReceived,
            stats.packetsReceived || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpAudioJitter,
            stats.jitter || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpAudioPacketsLost,
            stats.packetsLost || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpAudioLevel,
            stats.audioLevel || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpAudioConcealedSamples,
            stats.concealedSamples || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpAudioConcealmentEvents,
            stats.concealmentEvents || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpAudioFecPacketsDiscarded,
            stats.fecPacketsDiscarded || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpAudioFecPacketsReceived,
            stats.fecPacketsReceived || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpAudioHeaderBytesReceived,
            stats.headerBytesReceived || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpAudioInsertedSamplesForDeceleration,
            stats.insertedSamplesForDeceleration || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpAudioJitterBufferDelay,
            stats.jitterBufferDelay || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpAudioJitterBufferEmittedCount,
            stats.jitterBufferEmittedCount || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpAudioJitterBufferMinimumDelay,
            stats.jitterBufferMinimumDelay || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpAudioJitterBufferTargetDelay,
            stats.jitterBufferTargetDelay || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpAudioLastPacketReceivedTimestamp,
            stats.lastPacketReceivedTimestamp || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpAudioNackCount,
            stats.nackCount || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpAudioPacketsDiscarded,
            stats.packetsDiscarded || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpAudioPlayoutId,
            stats.playoutId || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpAudioRemovedSamplesForAcceleration,
            stats.removedSamplesForAcceleration || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpAudioSilentConcealedSamples,
            stats.silentConcealedSamples || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpAudioTotalAudioEnergy,
            stats.totalAudioEnergy || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpAudioTotalSamplesDuration,
            stats.totalSamplesDuration || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpAudioTotalSamplesReceived,
            stats.totalSamplesReceived || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpAudioTrackIdentifier,
            stats.trackIdentifier || 0,
            attributes,
          );
        };

        meter.addBatchObservableCallback(observableCallback, [
          inboundRtpAudioBytesReceived,
          inboundRtpAudioPacketsReceived,
          inboundRtpAudioJitter,
          inboundRtpAudioPacketsLost,
          inboundRtpAudioLevel,
          inboundRtpAudioConcealedSamples,
          inboundRtpAudioConcealmentEvents,
          inboundRtpAudioFecPacketsDiscarded,
          inboundRtpAudioFecPacketsReceived,
          inboundRtpAudioHeaderBytesReceived,
          inboundRtpAudioInsertedSamplesForDeceleration,
          inboundRtpAudioJitterBufferDelay,
          inboundRtpAudioJitterBufferEmittedCount,
          inboundRtpAudioJitterBufferMinimumDelay,
          inboundRtpAudioJitterBufferTargetDelay,
          inboundRtpAudioLastPacketReceivedTimestamp,
          inboundRtpAudioNackCount,
          inboundRtpAudioPacketsDiscarded,
          inboundRtpAudioPlayoutId,
          inboundRtpAudioRemovedSamplesForAcceleration,
          inboundRtpAudioSilentConcealedSamples,
          inboundRtpAudioTotalAudioEnergy,
          inboundRtpAudioTotalSamplesDuration,
          inboundRtpAudioTotalSamplesReceived,
          inboundRtpAudioTrackIdentifier,
        ]);
      } else if (trackType === "video") {
        const inboundRtpVideoDecoderImplementation =
          meter.createObservableGauge(
            "inbound_rtp_video_decoder_implementation",
            {
              description: "Decoder implementation for inbound RTP video",
            },
          );
        const inboundRtpVideoFirCount = meter.createObservableCounter(
          "inbound_rtp_video_fir_count",
          {
            description: "FIR count for inbound RTP video",
          },
        );
        const inboundRtpVideoFrameHeight = meter.createObservableGauge(
          "inbound_rtp_video_frame_height",
          {
            description: "Frame height for inbound RTP video",
          },
        );
        const inboundRtpVideoFrameWidth = meter.createObservableGauge(
          "inbound_rtp_video_frame_width",
          {
            description: "Frame width for inbound RTP video",
          },
        );
        const inboundRtpVideoFramesAssembledFromMultiplePackets =
          meter.createObservableCounter(
            "inbound_rtp_video_frames_assembled_from_multiple_packets",
            {
              description:
                "Frames assembled from multiple packets for inbound RTP video",
            },
          );
        const inboundRtpVideoFramesDecoded = meter.createObservableCounter(
          "inbound_rtp_video_frames_decoded",
          {
            description: "Frames decoded for inbound RTP video",
          },
        );
        const inboundRtpVideoFramesDropped = meter.createObservableCounter(
          "inbound_rtp_video_frames_dropped",
          {
            description: "Frames dropped for inbound RTP video",
          },
        );
        const inboundRtpVideoFramesPerSecond = meter.createObservableGauge(
          "inbound_rtp_video_frames_per_second",
          {
            description: "Frames per second for inbound RTP video",
          },
        );
        const inboundRtpVideoFramesReceived = meter.createObservableCounter(
          "inbound_rtp_video_frames_received",
          {
            description: "Frames received for inbound RTP video",
          },
        );
        const inboundRtpVideoFreezeCount = meter.createObservableCounter(
          "inbound_rtp_video_freeze_count",
          {
            description: "Freeze count for inbound RTP video",
          },
        );
        const inboundRtpVideoHeaderBytesReceived = meter.createObservableGauge(
          "inbound_rtp_video_header_bytes_received",
          {
            description: "Header bytes received for inbound RTP video",
          },
        );
        const inboundRtpVideoJitterBufferDelay = meter.createObservableGauge(
          "inbound_rtp_video_jitter_buffer_delay",
          {
            description: "Jitter buffer delay for inbound RTP video",
          },
        );
        const inboundRtpVideoJitterBufferEmittedCount =
          meter.createObservableCounter(
            "inbound_rtp_video_jitter_buffer_emitted_count",
            {
              description: "Jitter buffer emitted count for inbound RTP video",
            },
          );
        const inboundRtpVideoJitterBufferMinimumDelay =
          meter.createObservableGauge(
            "inbound_rtp_video_jitter_buffer_minimum_delay",
            {
              description: "Jitter buffer minimum delay for inbound RTP video",
            },
          );
        const inboundRtpVideoJitterBufferTargetDelay =
          meter.createObservableGauge(
            "inbound_rtp_video_jitter_buffer_target_delay",
            {
              description: "Jitter buffer target delay for inbound RTP video",
            },
          );
        const inboundRtpVideoKeyFramesDecoded = meter.createObservableCounter(
          "inbound_rtp_video_key_frames_decoded",
          {
            description: "Key frames decoded for inbound RTP video",
          },
        );
        const inboundRtpVideoLastPacketReceivedTimestamp =
          meter.createObservableGauge(
            "inbound_rtp_video_last_packet_received_timestamp",
            {
              description:
                "Last packet received timestamp for inbound RTP video",
            },
          );
        const inboundRtpVideoMid = meter.createObservableCounter(
          "inbound_rtp_video_mid",
          {
            description: "MID for inbound RTP video",
          },
        );
        const inboundRtpVideoNackCount = meter.createObservableCounter(
          "inbound_rtp_video_nack_count",
          {
            description: "NACK count for inbound RTP video",
          },
        );
        const inboundRtpVideoPauseCount = meter.createObservableCounter(
          "inbound_rtp_video_pause_count",
          {
            description: "Pause count for inbound RTP video",
          },
        );
        const inboundRtpVideoPliCount = meter.createObservableCounter(
          "inbound_rtp_video_pli_count",
          {
            description: "PLI count for inbound RTP video",
          },
        );
        const inboundRtpVideoPowerEfficientDecoder =
          meter.createObservableGauge(
            "inbound_rtp_video_power_efficient_decoder",
            {
              description: "Power efficient decoder for inbound RTP video",
            },
          );
        const inboundRtpVideoQpSum = meter.createObservableCounter(
          "inbound_rtp_video_qp_sum",
          {
            description: "QP sum for inbound RTP video",
          },
        );
        const inboundRtpVideoRemoteId = meter.createObservableCounter(
          "inbound_rtp_video_remote_id",
          {
            description: "Remote ID for inbound RTP video",
          },
        );
        const inboundRtpVideoTotalAssemblyTime = meter.createObservableGauge(
          "inbound_rtp_video_total_assembly_time",
          {
            description: "Total assembly time for inbound RTP video",
          },
        );
        const inboundRtpVideoTotalDecodeTime = meter.createObservableGauge(
          "inbound_rtp_video_total_decode_time",
          {
            description: "Total decode time for inbound RTP video",
          },
        );
        const inboundRtpVideoTotalFreezesDuration = meter.createObservableGauge(
          "inbound_rtp_video_total_freezes_duration",
          {
            description: "Total freezes duration for inbound RTP video",
          },
        );
        const inboundRtpVideoTotalInterFrameDelay = meter.createObservableGauge(
          "inbound_rtp_video_total_inter_frame_delay",
          {
            description: "Total inter frame delay for inbound RTP video",
          },
        );
        const inboundRtpVideoTotalPausesDuration = meter.createObservableGauge(
          "inbound_rtp_video_total_pauses_duration",
          {
            description: "Total pauses duration for inbound RTP video",
          },
        );
        const inboundRtpVideoTotalProcessingDelay = meter.createObservableGauge(
          "inbound_rtp_video_total_processing_delay",
          {
            description: "Total processing delay for inbound RTP video",
          },
        );
        const inboundRtpVideoTotalSquaredInterFrameDelay =
          meter.createObservableGauge(
            "inbound_rtp_video_total_squared_inter_frame_delay",
            {
              description:
                "Total squared inter frame delay for inbound RTP video",
            },
          );
        const inboundRtpVideoTrackIdentifier = meter.createObservableCounter(
          "inbound_rtp_video_track_identifier",
          {
            description: "Track identifier for inbound RTP video",
          },
        );

        const observableCallback: BatchObservableCallback = (
          observableRegistry,
        ) => {
          observableRegistry.observe(
            inboundRtpVideoDecoderImplementation,
            stats.decoderImplementation || "",
            attributes,
          );
          observableRegistry.observe(
            inboundRtpVideoFirCount,
            stats.firCount || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpVideoFrameHeight,
            stats.frameHeight || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpVideoFrameWidth,
            stats.frameWidth || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpVideoFramesAssembledFromMultiplePackets,
            stats.framesAssembledFromMultiplePackets || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpVideoFramesDecoded,
            stats.framesDecoded || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpVideoFramesDropped,
            stats.framesDropped || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpVideoFramesPerSecond,
            stats.framesPerSecond || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpVideoFramesReceived,
            stats.framesReceived || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpVideoFreezeCount,
            stats.freezeCount || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpVideoHeaderBytesReceived,
            stats.headerBytesReceived || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpVideoJitterBufferDelay,
            stats.jitterBufferDelay || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpVideoJitterBufferEmittedCount,
            stats.jitterBufferEmittedCount || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpVideoJitterBufferMinimumDelay,
            stats.jitterBufferMinimumDelay || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpVideoJitterBufferTargetDelay,
            stats.jitterBufferTargetDelay || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpVideoKeyFramesDecoded,
            stats.keyFramesDecoded || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpVideoLastPacketReceivedTimestamp,
            stats.lastPacketReceivedTimestamp || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpVideoMid,
            stats.mid || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpVideoNackCount,
            stats.nackCount || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpVideoPauseCount,
            stats.pauseCount || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpVideoPliCount,
            stats.pliCount || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpVideoPowerEfficientDecoder,
            stats.powerEfficientDecoder || false,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpVideoQpSum,
            stats.qpSum || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpVideoRemoteId,
            stats.remoteId || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpVideoTotalAssemblyTime,
            stats.totalAssemblyTime || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpVideoTotalDecodeTime,
            stats.totalDecodeTime || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpVideoTotalFreezesDuration,
            stats.totalFreezesDuration || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpVideoTotalInterFrameDelay,
            stats.totalInterFrameDelay || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpVideoTotalPausesDuration,
            stats.totalPausesDuration || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpVideoTotalProcessingDelay,
            stats.totalProcessingDelay || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpVideoTotalSquaredInterFrameDelay,
            stats.totalSquaredInterFrameDelay || 0,
            attributes,
          );
          observableRegistry.observe(
            inboundRtpVideoTrackIdentifier,
            stats.trackIdentifier || 0,
            attributes,
          );
        };

        meter.addBatchObservableCallback(observableCallback, [
          inboundRtpVideoDecoderImplementation,
          inboundRtpVideoFirCount,
          inboundRtpVideoFrameHeight,
          inboundRtpVideoFrameWidth,
          inboundRtpVideoFramesAssembledFromMultiplePackets,
          inboundRtpVideoFramesDecoded,
          inboundRtpVideoFramesDropped,
          inboundRtpVideoFramesPerSecond,
          inboundRtpVideoFramesReceived,
          inboundRtpVideoFreezeCount,
          inboundRtpVideoHeaderBytesReceived,
          inboundRtpVideoJitterBufferDelay,
          inboundRtpVideoJitterBufferEmittedCount,
          inboundRtpVideoJitterBufferMinimumDelay,
          inboundRtpVideoJitterBufferTargetDelay,
          inboundRtpVideoKeyFramesDecoded,
          inboundRtpVideoLastPacketReceivedTimestamp,
          inboundRtpVideoMid,
          inboundRtpVideoNackCount,
          inboundRtpVideoPauseCount,
          inboundRtpVideoPliCount,
          inboundRtpVideoPowerEfficientDecoder,
          inboundRtpVideoQpSum,
          inboundRtpVideoRemoteId,
          inboundRtpVideoTotalAssemblyTime,
          inboundRtpVideoTotalDecodeTime,
          inboundRtpVideoTotalFreezesDuration,
          inboundRtpVideoTotalInterFrameDelay,
          inboundRtpVideoTotalPausesDuration,
          inboundRtpVideoTotalProcessingDelay,
          inboundRtpVideoTotalSquaredInterFrameDelay,
          inboundRtpVideoTrackIdentifier,
        ]);
      }
      break;
    case "media-playout":
      const mediaPlayoutSynthesizedSamplesDuration =
        meter.createObservableGauge(
          "media_playout_synthesized_samples_duration",
          {
            description: "Synthesized samples duration for media playout",
          },
        );
      const mediaPlayoutSynthesizedSamplesEvents =
        meter.createObservableCounter(
          "media_playout_synthesized_samples_events",
          {
            description: "Synthesized samples events for media playout",
          },
        );
      const mediaPlayoutTotalPlayoutDelay = meter.createObservableGauge(
        "media_playout_total_playout_delay",
        {
          description: "Total playout delay for media playout",
        },
      );
      const mediaPlayoutTotalSamplesCount = meter.createObservableCounter(
        "media_playout_total_samples_count",
        {
          description: "Total samples count for media playout",
        },
      );
      const mediaPlayoutTotalSamplesDuration = meter.createObservableGauge(
        "media_playout_total_samples_duration",
        {
          description: "Total samples duration for media playout",
        },
      );

      const mediaPlayoutObservableCallback: BatchObservableCallback = (
        observableRegistry,
      ) => {
        const attributes = {
          participant: participantName,
          trackType,
          roomName,
        };
        observableRegistry.observe(
          mediaPlayoutSynthesizedSamplesDuration,
          stats.synthesizedSamplesDuration || 0,
          attributes,
        );
        observableRegistry.observe(
          mediaPlayoutSynthesizedSamplesEvents,
          stats.synthesizedSamplesEvents || 0,
          attributes,
        );
        observableRegistry.observe(
          mediaPlayoutTotalPlayoutDelay,
          stats.totalPlayoutDelay || 0,
          attributes,
        );
        observableRegistry.observe(
          mediaPlayoutTotalSamplesCount,
          stats.totalSamplesCount || 0,
          attributes,
        );
        observableRegistry.observe(
          mediaPlayoutTotalSamplesDuration,
          stats.totalSamplesDuration || 0,
          attributes,
        );
      };

      meter.addBatchObservableCallback(mediaPlayoutObservableCallback, [
        mediaPlayoutSynthesizedSamplesDuration,
        mediaPlayoutSynthesizedSamplesEvents,
        mediaPlayoutTotalPlayoutDelay,
        mediaPlayoutTotalSamplesCount,
        mediaPlayoutTotalSamplesDuration,
      ]);
      break;

    case "remote-outbound-rtp":
      const remoteOutboundRtpBytesSent = meter.createObservableGauge(
        "remote_outbound_rtp_bytes_sent",
        {
          description: "Bytes sent for remote outbound RTP",
        },
      );
      const remoteOutboundRtpPacketsSent = meter.createObservableCounter(
        "remote_outbound_rtp_packets_sent",
        {
          description: "Packets sent for remote outbound RTP",
        },
      );
      const remoteOutboundRtpTotalRoundTripTime = meter.createObservableGauge(
        "remote_outbound_rtp_total_round_trip_time",
        {
          description: "Total round trip time for remote outbound RTP",
        },
      );
      const remoteOutboundRtpRoundTripTimeMeasurements =
        meter.createObservableCounter(
          "remote_outbound_rtp_round_trip_time_measurements",
          {
            description: "Round trip time measurements for remote outbound RTP",
          },
        );
      const remoteOutboundRtpReportsSent = meter.createObservableCounter(
        "remote_outbound_rtp_reports_sent",
        {
          description: "Reports sent for remote outbound RTP",
        },
      );

      const remoteOutboundRtpObservableCallback: BatchObservableCallback = (
        observableRegistry,
      ) => {
        const attributes = {
          participant: participantName,
          trackType,
          roomName,
        };
        observableRegistry.observe(
          remoteOutboundRtpBytesSent,
          stats.bytesSent || 0,
          attributes,
        );
        observableRegistry.observe(
          remoteOutboundRtpPacketsSent,
          stats.packetsSent || 0,
          attributes,
        );
        observableRegistry.observe(
          remoteOutboundRtpTotalRoundTripTime,
          stats.totalRoundTripTime || 0,
          attributes,
        );
        observableRegistry.observe(
          remoteOutboundRtpRoundTripTimeMeasurements,
          stats.roundTripTimeMeasurements || 0,
          attributes,
        );
        observableRegistry.observe(
          remoteOutboundRtpReportsSent,
          stats.reportsSent || 0,
          attributes,
        );
      };

      meter.addBatchObservableCallback(remoteOutboundRtpObservableCallback, [
        remoteOutboundRtpBytesSent,
        remoteOutboundRtpPacketsSent,
        remoteOutboundRtpTotalRoundTripTime,
        remoteOutboundRtpRoundTripTimeMeasurements,
        remoteOutboundRtpReportsSent,
      ]);
      break;

    case "remote-inbound-rtp":
      const remoteInboundRtpJitter = meter.createObservableGauge(
        "remote_inbound_rtp_jitter",
        {
          description: "Jitter for remote inbound RTP",
        },
      );
      const remoteInboundRtpPacketsLost = meter.createObservableCounter(
        "remote_inbound_rtp_packets_lost",
        {
          description: "Packets lost for remote inbound RTP",
        },
      );
      const remoteInboundRtpFractionLost = meter.createObservableGauge(
        "remote_inbound_rtp_fraction_lost",
        {
          description: "Fraction lost for remote inbound RTP",
        },
      );
      const remoteInboundRtpRoundTripTime = meter.createObservableGauge(
        "remote_inbound_rtp_round_trip_time",
        {
          description: "Round trip time for remote inbound RTP",
        },
      );
      const remoteInboundRtpRoundTripTimeMeasurements =
        meter.createObservableCounter(
          "remote_inbound_rtp_round_trip_time_measurements",
          {
            description: "Round trip time measurements for remote inbound RTP",
          },
        );
      const remoteInboundRtpTotalRoundTripTime = meter.createObservableGauge(
        "remote_inbound_rtp_total_round_trip_time",
        {
          description: "Total round trip time for remote inbound RTP",
        },
      );

      const remoteInboundRtpObservableCallback: BatchObservableCallback = (
        observableRegistry,
      ) => {
        const attributes = {
          participant: participantName,
          trackType,
          roomName,
        };
        observableRegistry.observe(
          remoteInboundRtpJitter,
          stats.jitter || 0,
          attributes,
        );
        observableRegistry.observe(
          remoteInboundRtpPacketsLost,
          stats.packetsLost || 0,
          attributes,
        );
        observableRegistry.observe(
          remoteInboundRtpFractionLost,
          stats.fractionLost || 0,
          attributes,
        );
        observableRegistry.observe(
          remoteInboundRtpRoundTripTime,
          stats.roundTripTime || 0,
          attributes,
        );
        observableRegistry.observe(
          remoteInboundRtpRoundTripTimeMeasurements,
          stats.roundTripTimeMeasurements || 0,
          attributes,
        );
        observableRegistry.observe(
          remoteInboundRtpTotalRoundTripTime,
          stats.totalRoundTripTime || 0,
          attributes,
        );
      };

      meter.addBatchObservableCallback(remoteInboundRtpObservableCallback, [
        remoteInboundRtpJitter,
        remoteInboundRtpPacketsLost,
        remoteInboundRtpFractionLost,
        remoteInboundRtpRoundTripTime,
        remoteInboundRtpRoundTripTimeMeasurements,
        remoteInboundRtpTotalRoundTripTime,
      ]);
      break;
    case "media-source":
      if (trackType === "audio") {
        const mediaSourceAudioLevel = meter.createObservableGauge(
          "media_source_audio_level",
          { description: "Audio level for media source audio" },
        );
        const mediaSourceAudioEchoReturnLoss = meter.createObservableGauge(
          "media_source_audio_echo_return_loss",
          { description: "Echo return loss for media source audio" },
        );
        const mediaSourceAudioEchoReturnLossEnhancement =
          meter.createObservableGauge(
            "media_source_audio_echo_return_loss_enhancement",
            {
              description:
                "Echo return loss enhancement for media source audio",
            },
          );
        const mediaSourceAudioTotalAudioEnergy = meter.createObservableGauge(
          "media_source_audio_total_audio_energy",
          { description: "Total audio energy for media source audio" },
        );
        const mediaSourceAudioTotalSamplesDuration =
          meter.createObservableGauge(
            "media_source_audio_total_samples_duration",
            { description: "Total samples duration for media source audio" },
          );

        const mediaSourceAudioCallback: BatchObservableCallback = (
          observableRegistry,
        ) => {
          const attributes = {
            participant: participantName,
            trackType,
            roomName,
          };
          observableRegistry.observe(
            mediaSourceAudioLevel,
            stats.audioLevel || 0,
            attributes,
          );
          observableRegistry.observe(
            mediaSourceAudioEchoReturnLoss,
            stats.echoReturnLoss || 0,
            attributes,
          );
          observableRegistry.observe(
            mediaSourceAudioEchoReturnLossEnhancement,
            stats.echoReturnLossEnhancement || 0,
            attributes,
          );
          observableRegistry.observe(
            mediaSourceAudioTotalAudioEnergy,
            stats.totalAudioEnergy || 0,
            attributes,
          );
          observableRegistry.observe(
            mediaSourceAudioTotalSamplesDuration,
            stats.totalSamplesDuration || 0,
            attributes,
          );
        };

        meter.addBatchObservableCallback(mediaSourceAudioCallback, [
          mediaSourceAudioLevel,
          mediaSourceAudioEchoReturnLoss,
          mediaSourceAudioEchoReturnLossEnhancement,
          mediaSourceAudioTotalAudioEnergy,
          mediaSourceAudioTotalSamplesDuration,
        ]);
      } else if (trackType === "video") {
        const mediaSourceVideoFrames = meter.createObservableCounter(
          "media_source_video_frames",
          { description: "Frames for media source video" },
        );
        const mediaSourceVideoFramesPerSecond = meter.createObservableGauge(
          "media_source_video_frames_per_second",
          { description: "Frames per second for media source video" },
        );
        const mediaSourceVideoHeight = meter.createObservableGauge(
          "media_source_video_height",
          { description: "Height for media source video" },
        );
        const mediaSourceVideoWidth = meter.createObservableGauge(
          "media_source_video_width",
          { description: "Width for media source video" },
        );

        const mediaSourceVideoCallback: BatchObservableCallback = (
          observableRegistry,
        ) => {
          const attributes = {
            participant: participantName,
            trackType,
            roomName,
          };
          observableRegistry.observe(
            mediaSourceVideoFrames,
            stats.frames || 0,
            attributes,
          );
          observableRegistry.observe(
            mediaSourceVideoFramesPerSecond,
            stats.framesPerSecond || 0,
            attributes,
          );
          observableRegistry.observe(
            mediaSourceVideoHeight,
            stats.height || 0,
            attributes,
          );
          observableRegistry.observe(
            mediaSourceVideoWidth,
            stats.width || 0,
            attributes,
          );
        };

        meter.addBatchObservableCallback(mediaSourceVideoCallback, [
          mediaSourceVideoFrames,
          mediaSourceVideoFramesPerSecond,
          mediaSourceVideoHeight,
          mediaSourceVideoWidth,
        ]);
      }
      break;

    case "candidate-pair":
      const candidatePairBytesReceived = meter.createObservableGauge(
        "candidate_pair_bytes_received",
        { description: "Bytes received for candidate pair" },
      );
      const candidatePairBytesSent = meter.createObservableGauge(
        "candidate_pair_bytes_sent",
        { description: "Bytes sent for candidate pair" },
      );
      const candidatePairPacketsReceived = meter.createObservableCounter(
        "candidate_pair_packets_received",
        { description: "Packets received for candidate pair" },
      );
      const candidatePairPacketsSent = meter.createObservableCounter(
        "candidate_pair_packets_sent",
        { description: "Packets sent for candidate pair" },
      );
      const candidatePairCurrentRoundTripTime = meter.createObservableGauge(
        "candidate_pair_current_rtt",
        { description: "Current round trip time for candidate pair" },
      );
      const candidatePairTotalRoundTripTime = meter.createObservableGauge(
        "candidate_pair_total_rtt",
        { description: "Total round trip time for candidate pair" },
      );

      const candidatePairCallback: BatchObservableCallback = (
        observableRegistry,
      ) => {
        const attributes = {
          participant: participantName,
          trackType,
          roomName,
        };
        observableRegistry.observe(
          candidatePairBytesReceived,
          stats.bytesReceived || 0,
          attributes,
        );
        observableRegistry.observe(
          candidatePairBytesSent,
          stats.bytesSent || 0,
          attributes,
        );
        observableRegistry.observe(
          candidatePairPacketsReceived,
          stats.packetsReceived || 0,
          attributes,
        );
        observableRegistry.observe(
          candidatePairPacketsSent,
          stats.packetsSent || 0,
          attributes,
        );
        observableRegistry.observe(
          candidatePairCurrentRoundTripTime,
          stats.currentRoundTripTime || 0,
          attributes,
        );
        observableRegistry.observe(
          candidatePairTotalRoundTripTime,
          stats.totalRoundTripTime || 0,
          attributes,
        );
      };

      meter.addBatchObservableCallback(candidatePairCallback, [
        candidatePairBytesReceived,
        candidatePairBytesSent,
        candidatePairPacketsReceived,
        candidatePairPacketsSent,
        candidatePairCurrentRoundTripTime,
        candidatePairTotalRoundTripTime,
      ]);
      break;

    default:
      console.warn(`Unknown stat type: ${statType}`);
      break;
  }
}

export async function sendRtcStatsTrace(
  stats: any,
  statType: string,
  participant: RemoteParticipant | LocalParticipant,
  track: RemoteTrackPublication | LocalTrackPublication,
  trackType: string,
  roomName: string,
): Promise<void> {
  const span = ElementCallOpenTelemetry.instance.tracer;
  // Set span attributes based on stat type and other parameters
  span.startActiveSpan(
    `Participant: ${extractNameFromIdentity(participant.identity)}, RTCStatsType: ${statType}`,
    {
      attributes: {
        "stat.type": statType,
        "track.sid": track.trackSid,
        "participant.identity": extractNameFromIdentity(participant.identity),
        "track.type": trackType,
        "room.name": roomName,
      },
    },
    (span) => {
      try {
        switch (statType) {
          case "codec":
            span.setAttribute("mimeType", stats.mimeType);
            span.setAttribute("clockRate", stats.clockRate);
            span.setAttribute("payloadType", stats.payloadType);
            if (trackType === "audio") {
              span.setAttribute("channels", stats.channels);
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
            span.setAttribute(
              "retransmittedBytesSent",
              stats.retransmittedBytesSent,
            );
            span.setAttribute(
              "retransmittedPacketsSent",
              stats.retransmittedPacketsSent,
            );
            span.setAttribute("targetBitrate", stats.targetBitrate);
            span.setAttribute(
              "totalPacketSendDelay",
              stats.totalPacketSendDelay,
            );
            span.setAttribute("codecId", stats.codecId);
            span.setAttribute("transportId", stats.transportId);
            span.setAttribute("active", stats.active);
            if (trackType === "video") {
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
            if (stats.contentType === "screenshare") {
              span.setAttribute("contentType", stats.contentType);
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
              span.setAttribute(
                "fecPacketsDiscarded",
                stats.fecPacketsDiscarded,
              );
              span.setAttribute("fecPacketsReceived", stats.fecPacketsReceived);
              span.setAttribute(
                "headerBytesReceived",
                stats.headerBytesReceived,
              );
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
              span.setAttribute(
                "totalSamplesDuration",
                stats.totalSamplesDuration,
              );
              span.setAttribute(
                "totalSamplesReceived",
                stats.totalSamplesReceived,
              );
              span.setAttribute("trackIdentifier", stats.trackIdentifier);
            } else if (trackType === "video") {
              span.setAttribute(
                "decoderImplementation",
                stats.decoderImplementation,
              );
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
              span.setAttribute(
                "headerBytesReceived",
                stats.headerBytesReceived,
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
              span.setAttribute("keyFramesDecoded", stats.keyFramesDecoded);
              span.setAttribute(
                "lastPacketReceivedTimestamp",
                stats.lastPacketReceivedTimestamp,
              );
              span.setAttribute("mid", stats.mid);
              span.setAttribute("nackCount", stats.nackCount);
              span.setAttribute("pauseCount", stats.pauseCount);
              span.setAttribute("pliCount", stats.pliCount);
              span.setAttribute(
                "powerEfficientDecoder",
                stats.powerEfficientDecoder,
              );
              span.setAttribute("qpSum", stats.qpSum);
              span.setAttribute("remoteId", stats.remoteId);
              span.setAttribute("totalAssemblyTime", stats.totalAssemblyTime);
              span.setAttribute("totalDecodeTime", stats.totalDecodeTime);
              span.setAttribute(
                "totalFreezesDuration",
                stats.totalFreezesDuration,
              );
              span.setAttribute(
                "totalInterFrameDelay",
                stats.totalInterFrameDelay,
              );
              span.setAttribute(
                "totalPausesDuration",
                stats.totalPausesDuration,
              );
              span.setAttribute(
                "totalProcessingDelay",
                stats.totalProcessingDelay,
              );
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
            span.setAttribute(
              "bytesDiscardedOnSend",
              stats.bytesDiscardedOnSend,
            );
            span.setAttribute("bytesReceived", stats.bytesReceived);
            span.setAttribute("bytesSent", stats.bytesSent);
            span.setAttribute("consentRequestsSent", stats.consentRequestsSent);
            span.setAttribute(
              "currentRoundTripTime",
              stats.currentRoundTripTime,
            );
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
            span.setAttribute(
              "packetsDiscardedOnSend",
              stats.packetsDiscardedOnSend,
            );
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
            if (trackType === "audio") {
              span.setAttribute("audioLevel", stats.audioLevel);
              span.setAttribute("totalAudioEnergy", stats.totalAudioEnergy);
              span.setAttribute(
                "totalSamplesDuration",
                stats.totalSamplesDuration,
              );
              span.setAttribute("echoReturnLoss", stats.echoReturnLoss);
              span.setAttribute(
                "echoReturnLossEnhancement",
                stats.echoReturnLossEnhancement,
              );
            } else if (trackType === "video") {
              span.setAttribute("frames", stats.frames);
              span.setAttribute("framesPerSecond", stats.framesPerSecond);
              span.setAttribute("height", stats.height);
              span.setAttribute("width", stats.width);
            }
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
            span.setAttribute(
              "totalSamplesDuration",
              stats.totalSamplesDuration,
            );
            break;
        }
        span.end();
      } catch (e) {
        logger.info(`Error in sending RTC stats trace: ${e}`);
      }
    },
  );
}
