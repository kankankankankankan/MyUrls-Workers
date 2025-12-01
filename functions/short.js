export async function onRequest(context) {
    const { request, env } = context;
    const kv = env.LINKS;

    // CORS 头部配置
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };

    try {
        // 检查 KV 是否有值
        if (!kv) {
            return new Response(JSON.stringify({
                Code: 201,
                Message: '请去Pages控制台-设置 将变量名称设定为“LINKS”并绑定KV命名空间然后重试部署！'
            }), { status: 200, headers: corsHeaders });
        }

        const method = request.method;
        let longUrl, shortKey;

        // 处理 OPTIONS 请求
        if (method === "OPTIONS") {
            return new Response(null, { status: 204, headers: corsHeaders });
        }

        // 处理 GET 请求
        if (method === "GET") {
            const url = new URL(request.url);
            longUrl = url.searchParams.get('longUrl');
            shortKey = url.searchParams.get('shortKey');

            if (!longUrl) {
                return new Response(JSON.stringify({
                    Code: 201,
                    Message: "No longUrl provided"
                }), { status: 200, headers: corsHeaders });
            }

            try {
                longUrl = decodeBase64(longUrl);
            } catch (err) {
                return new Response(JSON.stringify({
                    Code: 201,
                    Message: "Invalid Base64 encoding for longUrl",
                    Error: err.message
                }), { status: 200, headers: corsHeaders });
            }

            return await handleUrlStorage(kv, longUrl, shortKey);
        }

        // 处理 POST 请求（自动兼容 JSON/表单/纯文本）
        else if (method === "POST") {
            const { longUrl: rawLongUrl, shortKey: rawShortKey, contentType } = await parseBodyAuto(request);

            if (!rawLongUrl) {
                return new Response(JSON.stringify({
                    Code: 201,
                    Message: "No longUrl provided (Content-Type: " + contentType + ")"
                }), { status: 200, headers: corsHeaders });
            }

            let decodedLongUrl;
            try {
                decodedLongUrl = decodeBase64(rawLongUrl);
            } catch (err) {
                return new Response(JSON.stringify({
                    Code: 201,
                    Message: "Invalid Base64 encoding for longUrl",
                    Error: err.message
                }), { status: 200, headers: corsHeaders });
            }

            return await handleUrlStorage(kv, decodedLongUrl, rawShortKey);
        }

        // 不支持的请求方法
        return new Response(JSON.stringify({
            Code: 405,
            Message: "Method not allowed"
        }), { status: 405, headers: corsHeaders });

    } catch (err) {
        // 全局捕获异常
        return new Response(JSON.stringify({
            Code: 500,
            Message: "Worker exception caught",
            Error: err.message || String(err),
            Stack: err.stack || null
        }), { status: 500, headers: corsHeaders });
    }

    /**
     * URL 存储逻辑
     */
    async function handleUrlStorage(kv, longUrl, shortKey) {
        // 检查违规域名
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
                return new Response(JSON.stringify({
                    Code: 201,
                    Message: `The custom shortKey \"${shortKey}\" already exists.`
                }), { status: 200, headers: corsHeaders });
            }
        } else {
            shortKey = generateRandomKey(7);
        }

        await kv.put(shortKey, longUrl);

        // 获取 Host 和客户端信息
        const host = request.headers.get("CDN-Client-Host") ||
                     request.headers.get("EO-Client-Host") ||
                     request.headers.get("host");
        const shortUrl = `https://${host}/${shortKey}`;
        const ip = request.headers.get("EO-Client-IP") ||
                   request.headers.get("cf-connecting-ip");
        const city = request.headers.get("EO-Client-City") ||
                     request.headers.get("cf-ipcity") ||
                     (request.cf && request.cf.city) || null;

        return new Response(JSON.stringify({
            Code: 1,
            Message: "URL stored successfully",
            ShortUrl: shortUrl,
            LongUrl: longUrl,
            ShortKey: shortKey,
            ip: ip,
            city: city
        }), { status: 200, headers: corsHeaders });
    }

    /**
     * 随机短码生成
     */
    function generateRandomKey(length) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    /**
     * Base64 解码
     */
    function decodeBase64(encodedString) {
        return atob(encodedString);
    }

    /**
     * 自动解析 POST 请求体
     */
    async function parseBodyAuto(request) {
        const contentType = (request.headers.get("content-type") || "").toLowerCase();

        // JSON
        if (contentType.includes("application/json")) {
            const data = await request.json().catch(() => ({}));
            return { longUrl: data.longUrl ?? null, shortKey: data.shortKey ?? null, contentType };
        }

        // 表单
        if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
            const formData = await request.formData();
            return { longUrl: formData.get("longUrl") ?? null, shortKey: formData.get("shortKey") ?? null, contentType };
        }

        // 纯文本尝试解析
        const raw = await request.text();
        try {
            const params = new URLSearchParams(raw);
            const maybeLong = params.get("longUrl");
            const maybeShort = params.get("shortKey");
            if (maybeLong !== null || maybeShort !== null) {
                return { longUrl: maybeLong, shortKey: maybeShort, contentType: contentType || "text/plain" };
            }
        } catch (_) {}

        return { longUrl: null, shortKey: null, contentType: contentType || "unknown" };
    }
}
