export const FETCH_ERROR_MESSAGE =
  'Cannot fetch due to CORS or network restrictions. Download the SVG and upload it, or paste its contents.';

export async function fetchSvgFromUrl(url: string, timeoutMs = 8000): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'image/svg+xml,text/plain;q=0.9,*/*;q=0.8',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP_${response.status}`);
    }

    return await response.text();
  } catch {
    throw new Error(FETCH_ERROR_MESSAGE);
  } finally {
    clearTimeout(timeout);
  }
}
