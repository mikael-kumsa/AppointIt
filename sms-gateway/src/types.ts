export type SmsSendRequest = {
  to: string;
  message: string;
  from?: string;
  vendorId?: string;
  appointmentId?: string;
};

export type SmsRecordStatus = "queued" | "sent" | "failed";

export type SmsRecord = {
  id: string;
  to: string;
  from: string;
  message: string;
  vendorId?: string;
  appointmentId?: string;
  provider: string;
  providerMessageId?: string;
  status: SmsRecordStatus;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export type SmsProviderResult = {
  providerMessageId: string;
};

export type SmsProvider = {
  name: string;
  send(record: SmsRecord): Promise<SmsProviderResult>;
};
