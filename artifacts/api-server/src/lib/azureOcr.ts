/**
 * Azure Computer Vision OCR helper.
 * Uses the 2024-02-01 Image Analysis API (synchronous, no polling needed).
 */

interface AzureReadLine {
  text: string;
}

interface AzureReadBlock {
  lines: AzureReadLine[];
}

interface AzureImageAnalysisResponse {
  readResult?: {
    blocks?: AzureReadBlock[];
  };
}

export async function azureOcr(
  base64Data: string,
  mediaType: string,
): Promise<string> {
  const endpoint = process.env.AZURE_COGNITIVE_ENDPOINT?.replace(/\/$/, "");
  const key = process.env.AZURE_COGNITIVE_KEY;

  if (!endpoint || !key) return "";

  const buffer = Buffer.from(base64Data, "base64");
  const url = `${endpoint}/computervision/imageanalysis:analyze?api-version=2024-02-01&features=read`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": mediaType || "image/jpeg",
      "Ocp-Apim-Subscription-Key": key,
    },
    body: buffer,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Azure OCR failed (${res.status}): ${err}`);
  }

  const data = (await res.json()) as AzureImageAnalysisResponse;
  const lines: string[] = [];

  for (const block of data.readResult?.blocks ?? []) {
    for (const line of block.lines ?? []) {
      if (line.text?.trim()) lines.push(line.text.trim());
    }
  }

  return lines.join("\n");
}
