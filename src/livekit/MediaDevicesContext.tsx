/*
Copyright 2023 New Vector Ltd

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import {
  FC,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createMediaDeviceObserver } from "@livekit/components-core";
import { Observable } from "rxjs";
import { logger } from "matrix-js-sdk/src/logger";

import {
  isFirefox,
  useAudioInput,
  useAudioOutput,
  useVideoInput,
} from "../settings/useSetting";

export interface MediaDevice {
  available: MediaDeviceInfo[];
  selectedId: string | undefined;
  select: (deviceId: string) => void;
}

export interface MediaDevices {
  audioInput: MediaDevice;
  audioOutput: MediaDevice;
  videoInput: MediaDevice;
  startUsingDeviceNames: () => void;
  stopUsingDeviceNames: () => void;
}

// Cargo-culted from @livekit/components-react
function useObservableState<T>(
  observable: Observable<T> | undefined,
  startWith: T,
): T {
  const [state, setState] = useState<T>(startWith);
  useEffect(() => {
    // observable state doesn't run in SSR
    if (typeof window === "undefined" || !observable) return;
    const subscription = observable.subscribe(setState);
    return (): void => subscription.unsubscribe();
  }, [observable]);
  return state;
}

function useMediaDevice(
  kind: MediaDeviceKind,
  fallbackDevice: string | undefined,
  usingNames: boolean,
  alwaysDefault: boolean = false,
): MediaDevice {
  // Make sure we don't needlessly reset to a device observer without names,
  // once permissions are already given
  const hasRequestedPermissions = useRef(false);
  const requestPermissions = usingNames || hasRequestedPermissions.current;
  hasRequestedPermissions.current ||= usingNames;

  // We use a bare device observer here rather than one of the fancy device
  // selection hooks from @livekit/components-react, because
  // useMediaDeviceSelect expects a room or track, which we don't have here, and
  // useMediaDevices provides no way to request device names.
  // Tragically, the only way to get device names out of LiveKit is to specify a
  // kind, which then results in multiple permissions requests.
  const deviceObserver = useMemo(
    () =>
      createMediaDeviceObserver(
        kind,
        () => logger.error("Error creating MediaDeviceObserver"),
        requestPermissions,
      ),
    [kind, requestPermissions],
  );
  const available = useObservableState(deviceObserver, []);
  const [selectedId, select] = useState(fallbackDevice);

  return useMemo(() => {
    let devId;
    if (available) {
      devId = available.some((d) => d.deviceId === selectedId)
        ? selectedId
        : available.some((d) => d.deviceId === fallbackDevice)
          ? fallbackDevice
          : available.at(0)?.deviceId;
    }

    return {
      available: available ?? [],
      selectedId: alwaysDefault ? undefined : devId,
      select,
    };
  }, [available, selectedId, fallbackDevice, select, alwaysDefault]);
}

const deviceStub: MediaDevice = {
  available: [],
  selectedId: undefined,
  select: () => {},
};
const devicesStub: MediaDevices = {
  audioInput: deviceStub,
  audioOutput: deviceStub,
  videoInput: deviceStub,
  startUsingDeviceNames: () => {},
  stopUsingDeviceNames: () => {},
};

const MediaDevicesContext = createContext<MediaDevices>(devicesStub);

interface Props {
  children: JSX.Element;
}

export const MediaDevicesProvider: FC<Props> = ({ children }) => {
  // Counts the number of callers currently using device names.
  const [numCallersUsingNames, setNumCallersUsingNames] = useState(0);
  const usingNames = numCallersUsingNames > 0;

  // Setting the audio device to something other than 'undefined' breaks echo-cancellation
  // and even can introduce multiple different output devices for one call.
  const alwaysUseDefaultAudio = isFirefox();

  // On FF we dont need to query the names
  // (call enumerateDevices + create meadia stream to trigger permissions)
  // for ouput devices because the selector wont be shown on FF.
  const useOutputNames = usingNames && !isFirefox();

  const [audioInputSetting, setAudioInputSetting] = useAudioInput();
  const [audioOutputSetting, setAudioOutputSetting] = useAudioOutput();
  const [videoInputSetting, setVideoInputSetting] = useVideoInput();

  const audioInput = useMediaDevice(
    "audioinput",
    audioInputSetting,
    usingNames,
  );
  const audioOutput = useMediaDevice(
    "audiooutput",
    audioOutputSetting,
    useOutputNames,
    alwaysUseDefaultAudio,
  );
  const videoInput = useMediaDevice(
    "videoinput",
    videoInputSetting,
    usingNames,
  );

  useEffect(() => {
    if (audioInput.selectedId !== undefined)
      setAudioInputSetting(audioInput.selectedId);
  }, [setAudioInputSetting, audioInput.selectedId]);

  useEffect(() => {
    // Skip setting state for ff output. Redundent since it is set to always return 'undefined'
    // but makes it clear while debugging that this is not happening on FF. + perf ;)
    if (audioOutput.selectedId !== undefined && !isFirefox())
      setAudioOutputSetting(audioOutput.selectedId);
  }, [setAudioOutputSetting, audioOutput.selectedId]);

  useEffect(() => {
    if (videoInput.selectedId !== undefined)
      setVideoInputSetting(videoInput.selectedId);
  }, [setVideoInputSetting, videoInput.selectedId]);

  const startUsingDeviceNames = useCallback(
    () => setNumCallersUsingNames((n) => n + 1),
    [setNumCallersUsingNames],
  );
  const stopUsingDeviceNames = useCallback(
    () => setNumCallersUsingNames((n) => n - 1),
    [setNumCallersUsingNames],
  );

  const context: MediaDevices = useMemo(
    () => ({
      audioInput,
      audioOutput,
      videoInput,
      startUsingDeviceNames,
      stopUsingDeviceNames,
    }),
    [
      audioInput,
      audioOutput,
      videoInput,
      startUsingDeviceNames,
      stopUsingDeviceNames,
    ],
  );

  return (
    <MediaDevicesContext.Provider value={context}>
      {children}
    </MediaDevicesContext.Provider>
  );
};

export const useMediaDevices = (): MediaDevices =>
  useContext(MediaDevicesContext);

/**
 * React hook that requests for the media devices context to be populated with
 * real device names while this component is mounted. This is not done by
 * default because it may involve requesting additional permissions from the
 * user.
 */
export const useMediaDeviceNames = (
  context: MediaDevices,
  enabled = true,
): void =>
  useEffect(() => {
    if (enabled) {
      context.startUsingDeviceNames();
      return context.stopUsingDeviceNames;
    }
  }, [context, enabled]);
