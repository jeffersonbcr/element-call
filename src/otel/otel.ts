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

import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import opentelemetry, { Tracer } from "@opentelemetry/api";
import { Resource } from "@opentelemetry/resources";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";
import { logger } from "matrix-js-sdk/src/logger";

import { PosthogSpanProcessor } from "../analytics/PosthogSpanProcessor";
import { Config } from "../config/Config";
import { RageshakeSpanProcessor } from "../analytics/RageshakeSpanProcessor";

const SERVICE_NAME = "element-call";

let sharedInstance: ElementCallOpenTelemetry;

export class ElementCallOpenTelemetry {
  private _provider: WebTracerProvider;
  private _tracer: Tracer;
  private otlpExporter?: OTLPTraceExporter;
  private metricProvider: MeterProvider;
  private metricExporter: OTLPMetricExporter;
  public readonly rageshakeProcessor?: RageshakeSpanProcessor;

  public static globalInit(): void {
    const config = Config.get();
    const shouldEnableOtlp = Boolean(
      config.opentelemetry?.collector_url_traces,
    );

    if (!sharedInstance || sharedInstance.isOtlpEnabled !== shouldEnableOtlp) {
      logger.info("(Re)starting OpenTelemetry debug reporting");
      sharedInstance?.dispose();

      sharedInstance = new ElementCallOpenTelemetry(
        config.opentelemetry?.collector_url_traces,
        config.opentelemetry?.collector_url_metrics,
        config.rageshake?.submit_url,
      );
    }
  }

  public static get instance(): ElementCallOpenTelemetry {
    return sharedInstance;
  }

  private constructor(
    traceCollectorUrl: string | undefined,
    metricsCollectorUrl: string | undefined,
    rageshakeUrl: string | undefined,
  ) {
    const resource = new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: SERVICE_NAME,
    });

    this.metricExporter = new OTLPMetricExporter({
      url: metricsCollectorUrl,
    });

    // this.metricProvider = new MeterProvider({
    //   resource,
    // });

    this.metricProvider = new MeterProvider({
      resource,
      readers: [
        new PeriodicExportingMetricReader({
          exporter: this.metricExporter,
          exportIntervalMillis: 10000,
        }),
      ],
    });

    this._provider = new WebTracerProvider({ resource });

    if (traceCollectorUrl) {
      logger.info(
        "Enabling OTLP traces collector with URL " + traceCollectorUrl,
      );
      this.otlpExporter = new OTLPTraceExporter({
        url: traceCollectorUrl,
      });
      this._provider.addSpanProcessor(
        new SimpleSpanProcessor(this.otlpExporter),
      );
    } else {
      logger.info("OTLP traces collector disabled");
    }

    if (metricsCollectorUrl) {
      logger.info(
        "Enabling OTLP metrics collector with URL " + metricsCollectorUrl,
      );
      this.metricExporter = new OTLPMetricExporter({
        url: metricsCollectorUrl,
      });

      this.metricProvider = new MeterProvider({
        resource,
        readers: [
          new PeriodicExportingMetricReader({
            exporter: this.metricExporter,
            exportIntervalMillis: 10000,
          }),
        ],
      });
    } else {
      logger.info("OTLP metrics collector disabled");
    }

    if (rageshakeUrl) {
      this.rageshakeProcessor = new RageshakeSpanProcessor();
      this._provider.addSpanProcessor(this.rageshakeProcessor);
    }

    this._provider.addSpanProcessor(new PosthogSpanProcessor());
    opentelemetry.trace.setGlobalTracerProvider(this._provider);
    if (opentelemetry.metrics.setGlobalMeterProvider(this.metricProvider)) {
      logger.info("Metrics provider set successfully");
    }

    this._tracer = opentelemetry.trace.getTracer("my-element-call-otl-tracer");
  }

  public dispose(): void {
    opentelemetry.trace.disable();
    this._provider?.shutdown();
    this.metricProvider?.shutdown();
  }

  public forceFlush(): void {
    this._provider.forceFlush();
    this.metricProvider.forceFlush();
  }

  public get isOtlpEnabled(): boolean {
    return Boolean(this.otlpExporter);
  }

  public get tracer(): Tracer {
    return this._tracer;
  }

  public get meterProvider(): MeterProvider {
    return this.metricProvider;
  }
}
