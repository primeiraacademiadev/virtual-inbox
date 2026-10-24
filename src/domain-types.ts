export type Channel = "email" | "sms";
export class Fault extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}
