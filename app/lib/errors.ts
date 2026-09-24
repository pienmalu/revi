/** 利用者へ理由を返せるエラー。HTTP や DB に依存しない。 */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export class IngestError extends Error {}
