export async function onRequest(context) {
  const { request, env } = context;
  const kv = env.LINKS;

  // 跨域配置：允许任意域名访问
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };

  try {
    if (!kv) {
      return new Response(JSON.stringify({
        Code: 201,
        Message: '请去Pages控制台-设置 将变量名称设定为“LINKS”并绑定KV命名空间然后重试部署！'
      }), { status: 200, headers: corsHeaders });
    }

    const method = request.method;

    // 处理 OPTIONS 预检请求
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // 处理 GET 请求
    if (method === "GET") {
      const url = new URL(request.url);
      let longUrl = url.searchParams.get("longUrl");
      let shortKey = url.searchParams.get("shortKey");

      if (!longUrl) {
        return new Response(JSON.stringify({ Code: 201, Message: "No longUrl provided" }), { status: 200, headers: corsHeaders });
      }

      try { longUrl = decodeBase64(longUrl); } catch (err) {
        return new Response(JSON.stringify({ Code: 201, Message: "Invalid Base64", Error: err.message }), { status: 200, headers: corsHeaders });
      }

      return await handleUrlStorage(kv, longUrl, shortKey);
    }

    // 处理 POST 请求
    if (method === "POST") {
      const { longUrl: rawLongUrl, shortKey: rawShortKey } = await parseBodyAuto(request);

      if (!rawLongUrl) {
        return new Response(JSON.stringify({ Code: 201, Message: "No longUrl provided" }), { status: 200, headers: corsHeaders });
      }

      let decodedLongUrl;
      try { decodedLongUrl = decodeBase64(rawLongUrl); } catch (err) {
        return new Response(JSON.stringify({ Code: 201, Message: "Invalid Base64", Error: err.message }), { status: 200, headers: corsHeaders });
      }

      return await handleUrlStorage(kv, decodedLongUrl, rawShortKey);
    }

    // 方法不允许
    return new Response(JSON.stringify({ Code: 405, Message: "Method not allowed" }), { status: 405, headers: corsHeaders });

  } catch (err) {
    return new Response(JSON.stringify({ Code: 500, Message: "Worker exception", Error: err.message }), { status: 500, headers: corsHeaders });
  }

  async function handleUrlStorage(kv, longUrl, shortKey) {
    const blockedDomains = ["cloudfront.net", "github.io"];
    for (const domain of blockedDomains) {
      if (longUrl.includes(domain)) {
        longUrl = "https://www.baidu.com/s?wd=%E5%9B%BD%E5%AE%B6%E5%8F%8D%E8%AF%88%E4%B8%AD%E5%BF%83APP";
        break;
      }
    }

    if (shortKey) {
      const existingValue = await kv.get(shortKey);
      if (existingValue) {
        return new Response(JSON.stringify({ Code: 201, Message: `The custom shortKey "${shortKey}" already exists.` }), { status: 200, headers: corsHeaders });
      }
    } else {
      shortKey = generateRandomKey(7);
    }

    await kv.put(shortKey, longUrl);

    const host = request.headers.get("host") || "example.pages.dev";
    const shortUrl = `https://${host}/${shortKey}`;
    const ip = request.headers.get("cf-connecting-ip") || null;
    const city = (request.cf && request.cf.city) || null;

    return new Response(JSON.stringify({ Code: 1, Message: "URL stored successfully", ShortUrl: shortUrl, LongUrl: longUrl, ShortKey: shortKey, ip, city }), { status: 200, headers: corsHeaders });
  }

  function generateRandomKey(length) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    for (let i = 0; i < length; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    return result;
  }

  function decodeBase64(str) {
    return atob(str);
  }

  async function parseBodyAuto(request) {
    const contentType = (request.headers.get("content-type") || "").toLowerCase();

    if (contentType.includes("application/json")) {
      const data = await request.json().catch(() => ({}));
      return { longUrl: data.longUrl ?? null, shortKey: data.shortKey ?? null };
    }

    if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      return { longUrl: formData.get("longUrl") ?? null, shortKey: formData.get("shortKey") ?? null };
    }

    const raw = await request.text();
    try {
      const params = new URLSearchParams(raw);
      return { longUrl: params.get("longUrl") ?? null, shortKey: params.get("shortKey") ?? null };
    } catch (_) { return { longUrl: null, shortKey: null }; }
  }
}
