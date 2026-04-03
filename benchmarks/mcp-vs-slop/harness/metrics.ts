import type { StepResult, ProtocolMetrics, ProtocolLabel } from "./types";

export class MetricsCollector {
  protocol: ProtocolLabel;
  private startTime = 0;
  private setupStart = 0;
  private setupEnd = 0;
  private stepStart = 0;
  private currentStep = "";
  private steps: StepResult[] = [];

  totalBytesSent = 0;
  totalBytesReceived = 0;
  totalMessagesSent = 0;
  totalMessagesReceived = 0;

  private stepBytesSent = 0;
  private stepBytesReceived = 0;
  private stepMessagesSent = 0;
  private stepMessagesReceived = 0;

  constructor(protocol: ProtocolLabel) {
    this.protocol = protocol;
  }

  beginSetup() {
    this.startTime = performance.now();
    this.setupStart = performance.now();
  }

  endSetup() {
    this.setupEnd = performance.now();
  }

  beginStep(name: string) {
    this.currentStep = name;
    this.stepStart = performance.now();
    this.stepBytesSent = 0;
    this.stepBytesReceived = 0;
    this.stepMessagesSent = 0;
    this.stepMessagesReceived = 0;
  }

  endStep() {
    this.steps.push({
      step: this.currentStep,
      durationMs: Math.round((performance.now() - this.stepStart) * 100) / 100,
      bytesSent: this.stepBytesSent,
      bytesReceived: this.stepBytesReceived,
      messagesSent: this.stepMessagesSent,
      messagesReceived: this.stepMessagesReceived,
    });
  }

  recordSend(bytes: number) {
    this.totalBytesSent += bytes;
    this.totalMessagesSent++;
    this.stepBytesSent += bytes;
    this.stepMessagesSent++;
  }

  recordReceive(bytes: number) {
    this.totalBytesReceived += bytes;
    this.totalMessagesReceived++;
    this.stepBytesReceived += bytes;
    this.stepMessagesReceived++;
  }

  toMetrics(): ProtocolMetrics {
    return {
      protocol: this.protocol,
      setupTimeMs: Math.round((this.setupEnd - this.setupStart) * 100) / 100,
      totalTimeMs: Math.round((performance.now() - this.startTime) * 100) / 100,
      totalBytesSent: this.totalBytesSent,
      totalBytesReceived: this.totalBytesReceived,
      totalMessagesSent: this.totalMessagesSent,
      totalMessagesReceived: this.totalMessagesReceived,
      steps: this.steps,
    };
  }
}
