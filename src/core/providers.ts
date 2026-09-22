// Official endpoints and free-plan documentation checked 2026-09-20.
// Presets contain no credentials, paid fallback or automatic account provisioning.
export const providers = [
 {id:'deepseek',name:'DeepSeek Flash · 官方 API',baseUrl:'https://api.deepseek.com',model:'deepseek-flash',signup:'https://platform.deepseek.com/api_keys',docs:'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',note:'按用量计费，需要个人 API Key。自动注释使用非思考模式并逐条显示，减少阅读等待；不会自动切换更贵的模型。'},
 {id:'zhipu',name:'智谱 GLM-4.7-Flash · 免费模型',baseUrl:'https://open.bigmodel.cn/api/paas/v4',model:'glm-4.7-flash',signup:'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',docs:'https://docs.bigmodel.cn/cn/guide/models/free/glm-4.7-flash',note:'国内平台，需注册并创建个人 API Key。仅预设 Flash 免费型号，不自动升级为付费型号；账户有并发/速率限制。已关闭深度思考以减少等待。'},
 {id:'groq',name:'Groq · 免费计划',baseUrl:'https://api.groq.com/openai/v1',model:'qwen/qwen3.8-27b',signup:'https://console.groq.com/keys',docs:'https://console.groq.com/docs/rate-limits',note:'需注册并创建免费 API Key。免费计划有请求/Token 限额；请在账户中确认仍使用 Free Plan。预设关闭深度思考以减少等待。'},
 {id:'openrouter',name:'OpenRouter · 免费模型路由',baseUrl:'https://openrouter.ai/api/v1',model:'openrouter/free',signup:'https://openrouter.ai/settings/keys',docs:'https://openrouter.ai/openrouter/free',note:'需注册并创建 API Key。仅路由到免费模型，不自动换付费模型；有请求限额，繁忙时可能排队，模型和质量可能变化。'},
 {id:'gemini',name:'Gemini · 免费额度',baseUrl:'https://generativelanguage.googleapis.com/v1beta/openai',model:'gemini-2.5-flash-lite',signup:'https://aistudio.google.com/apikey',docs:'https://ai.google.dev/gemini-api/docs/pricing#gemini-2.5-flash-lite',note:'需免费项目和个人 Key；开启计费的项目可能收费。中国大陆不在官方支持地区。免费层内容可能用于改进产品，请只提交愿意分享的文本。'},
] as const;
export function providerFor(baseUrl:string,model:string){return providers.find(p=>p.baseUrl===baseUrl.replace(/\/$/,'')&&p.model===model);}
export function providerOptions(baseUrl:string,model:string){
 const host=new URL(baseUrl).hostname;
 if(host==='api.deepseek.com'&&['deepseek-flash','deepseek-v4-flash','deepseek-chat'].includes(model))return {thinking:{type:'disabled'}};
 if(host==='open.bigmodel.cn'&&model==='glm-4.7-flash')return {thinking:{type:'disabled'}};
 return host==='api.groq.com'&&model==='qwen/qwen3.8-27b'?{reasoning_effort:'none'}:{};
}
