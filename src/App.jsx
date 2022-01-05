/*
Copyright 2021 New Vector Ltd

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

import React, { useEffect, useState } from "react";
import {
  BrowserRouter as Router,
  Switch,
  Route,
  useLocation,
  useHistory,
} from "react-router-dom";
import * as Sentry from "@sentry/react";
import { OverlayProvider } from "@react-aria/overlays";
import { HomePage } from "./home/HomePage";
import { LoginPage } from "./LoginPage";
import { RegisterPage } from "./RegisterPage";
import { Room } from "./Room";
import {
  ClientProvider,
  defaultHomeserverHost,
} from "./ConferenceCallManagerHooks";
import { LoadingView } from "./FullScreenView";
import { usePageFocusStyle } from "./usePageFocusStyle";
const SentryRoute = Sentry.withSentryRouting(Route);

export default function App({ history }) {
  usePageFocusStyle();

  return (
    <Router history={history}>
      <ClientProvider>
        <OverlayProvider>
          <Switch>
            <SentryRoute exact path="/">
              <HomePage />
            </SentryRoute>
            <SentryRoute exact path="/login">
              <LoginPage />
            </SentryRoute>
            <SentryRoute exact path="/register">
              <RegisterPage />
            </SentryRoute>
            <SentryRoute path="/room/:roomId?">
              <Room />
            </SentryRoute>
            <SentryRoute path="*">
              <RoomRedirect />
            </SentryRoute>
          </Switch>
        </OverlayProvider>
      </ClientProvider>
    </Router>
  );
}

function RoomRedirect() {
  const { pathname } = useLocation();
  const history = useHistory();

  useEffect(() => {
    let roomId = pathname;

    if (pathname.startsWith("/")) {
      roomId = roomId.substr(1, roomId.length);
    }

    if (!roomId.startsWith("#") && !roomId.startsWith("!")) {
      roomId = `#${roomId}:${defaultHomeserverHost}`;
    }

    history.replace(`/room/${roomId}`);
  }, [pathname, history]);

  return <LoadingView />;
}
