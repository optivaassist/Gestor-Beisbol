/**
 * Utility for safe API fetch and response parsing.
 * Prevents "Unexpected token '<', '<!doctype '... is not valid JSON" errors
 * when the server or a proxy returns an HTML page instead of JSON.
 */

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  isHighDemand?: boolean;
  [key: string]: any;
}

export async function parseApiResponse<T = any>(
  response: Response,
  defaultErrorMsg = 'Ocurrió un error al procesar la solicitud en el servidor.'
): Promise<ApiResponse<T>> {
  const status = response.status;
  const contentType = response.headers.get('content-type') || '';

  let rawText = '';
  try {
    rawText = await response.text();
  } catch (err: any) {
    throw new Error(`Error de lectura en la respuesta del servidor: ${err?.message || 'Error de red'}`);
  }

  // Check if response is HTML (e.g. <!doctype html> or <html>)
  const isHtml =
    contentType.includes('text/html') ||
    rawText.trim().toLowerCase().startsWith('<!doctype') ||
    rawText.trim().toLowerCase().startsWith('<html');

  if (isHtml) {
    console.error('Server returned HTML response instead of JSON. Status:', status, rawText.slice(0, 300));
    if (status === 413) {
      throw new Error('El archivo del libro es demasiado grande para procesarlo en el servidor (supera el límite de subida). Por favor selecciona una foto de menor resolución o recortada.');
    }
    if (status === 502 || status === 504) {
      throw new Error('El servidor tardó demasiado en procesar el libro (tiempo de espera agotado). Por favor intenta de nuevo.');
    }
    if (status === 503) {
      throw new Error('El servicio de IA se encuentra temporalmente ocupado o con alta demanda. Por favor espera unos momentos y vuelve a presionar Reintentar.');
    }
    if (status === 404) {
      throw new Error('El punto de acceso del servidor no fue encontrado (/api). Por favor verifica que el servidor esté activo.');
    }
    throw new Error(`El servidor devolvió una respuesta no válida (código HTTP ${status}). Por favor recarga la página o intenta de nuevo.`);
  }

  // Attempt to parse JSON safely
  let parsed: any = null;
  try {
    parsed = JSON.parse(rawText);
  } catch (parseErr) {
    console.error('JSON parse error on raw text:', rawText.slice(0, 300));
    throw new Error(
      `El servidor devolvió una respuesta con formato inválido (código HTTP ${status}). ${rawText.slice(0, 120)}`
    );
  }

  // Check for HTTP errors or logical failure in payload
  if (!response.ok || (parsed && parsed.success === false)) {
    const errorMsg =
      parsed?.error ||
      (status === 413
        ? 'El archivo es demasiado grande para ser procesado. Selecciona una imagen más comprimida.'
        : status === 503
        ? 'El servicio de IA está experimentando alta demanda. Por favor reintenta en unos instantes.'
        : defaultErrorMsg);

    const error = new Error(errorMsg);
    (error as any).isHighDemand = parsed?.isHighDemand || status === 503;
    (error as any).status = status;
    throw error;
  }

  return parsed as ApiResponse<T>;
}
