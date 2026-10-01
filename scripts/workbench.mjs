import {createWorkbench} from '../dist-workbench-server/server.mjs';
const port=Number(process.env.EASY_LEARN_PORT??4178);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('EASY_LEARN_PORT 必须是有效端口。');
const server=createWorkbench();
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'端口已被占用，请设置 EASY_LEARN_PORT 后重试。':'工作台启动失败，请检查本机环境。');process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log(`Easy Learn 阅读工作台：http://127.0.0.1:${port}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close());
