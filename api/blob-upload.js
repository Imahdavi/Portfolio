const { handleUpload } = require('@vercel/blob/client');

// Mints short-lived client tokens so the browser can PUT files straight to
// Vercel Blob (bypassing this function's own body-size limits) — the actual
// bytes never pass through here, only the token request and the completion
// webhook. No admin auth check here: the site's existing uploads (Supabase)
// had none either (the anon key + path were already public in page source),
// so this doesn't lower the bar that was already set.
module.exports = async function handler(request, response) {
  try {
    const jsonResponse = await handleUpload({
      body: request.body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ['image/*', 'video/*'],
        addRandomSuffix: false,
        maximumSizeInBytes: 500 * 1024 * 1024,
      }),
      onUploadCompleted: async () => {},
    });
    return response.status(200).json(jsonResponse);
  } catch (error) {
    return response.status(400).json({ error: error.message });
  }
};
