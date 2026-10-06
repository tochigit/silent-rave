export function uploadFailure(status: number, message?: string): string {
  if (message) return message;
  if (status === 413) return "Upload too large. Choose a smaller image under 3 MiB and retry. Your fields are saved.";
  if (status === 503) return "Image storage is temporarily unavailable. Your fields are saved; retry when connected.";
  return "Upload was not accepted. Your fields are saved; check your status and retry.";
}
