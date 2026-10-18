
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      error: "Use POST for image generation."
    });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({
      error: "Add OPENAI_API_KEY in Vercel Environment Variables, then redeploy."
    });
  }

  try {
    const body = req.body || {};
    const prompt =
      typeof body.prompt === "string" ? body.prompt.trim() : "";

    if (!prompt) {
      return res.status(400).json({ error: "A prompt is required." });
    }

    if (prompt.length > 12000) {
      return res.status(413).json({ error: "Prompt is too long." });
    }

    const response = await fetch(
      "https://api.openai.com/v1/images/generations",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1.5",
          prompt,
          size: "1024x1024",
          quality: "medium",
          n: 1
        })
      }
    );

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      return res.status(502).json({
        error: result?.error?.message || "Image generation failed."
      });
    }

    const item = result?.data?.[0];

    if (!item?.b64_json) {
      return res.status(502).json({
        error: "No image was returned."
      });
    }

    return res.status(200).json({
      image: `data:image/png;base64,${item.b64_json}`,
      model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1.5"
    });
  } catch {
    return res.status(500).json({
      error: "Image generation failed. Please try again."
    });
  }
      }
