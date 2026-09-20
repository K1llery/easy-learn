import type { Concept, Profile } from '../core/types';
import type { LocalCandidate } from './candidates';
// Original, short general definitions. Never infer the meaning of ambiguous initials (DR, ML, etc.).
const entries:Record<string,[string,string,string?]>={
 'api':['应用程序接口','程序之间约定的调用方式：规定能请求什么、怎样传参和返回什么。','Application Programming Interface'],
 'http':['超文本传输协议','浏览器与服务器交换请求和响应时使用的一套规则。','Hypertext Transfer Protocol'],
 'https':['加密的 HTTP','通过 TLS 加密传输的 HTTP，保护传输途中的内容。','Hypertext Transfer Protocol Secure'],
 'json':['JSON 数据格式','用对象、数组和基本值表示数据的文本格式，常用于接口传输。','JavaScript Object Notation'],
 'html':['网页标记语言','用标签描述网页内容和结构；它本身不负责程序逻辑。','HyperText Markup Language'],
 'css':['层叠样式表','控制网页的颜色、排版和布局。','Cascading Style Sheets'],
 'sql':['结构化查询语言','用来查询和修改关系型数据库中的数据。','Structured Query Language'],
 'cli':['命令行界面','通过输入文本命令操作工具，而不是点击图形按钮。','Command-Line Interface'],
 'sdk':['软件开发工具包','供开发者调用某个平台的一组库、接口和配套工具。','Software Development Kit'],
 'url':['资源地址','指出网络资源的位置，例如网页地址。','Uniform Resource Locator'],
 'dns':['域名系统','把域名解析为网络地址等记录，帮助客户端找到服务。','Domain Name System'],
 'tls':['传输层安全协议','在通信双方之间建立加密通道，并校验对端身份。','Transport Layer Security'],
 'ssh':['安全远程连接协议','通过加密连接登录远程机器或执行命令。','Secure Shell'],
 'asgi':['异步服务器网关接口','Python Web 服务器与应用之间的异步接口标准。','Asynchronous Server Gateway Interface'],
 'wsgi':['Web 服务器网关接口','Python Web 服务器与应用之间的同步调用接口标准。','Web Server Gateway Interface'],
 'dependency injection':['依赖注入','由外部提供函数或对象需要的依赖，避免它自己创建所有依赖。'],
 'virtual environment':['虚拟环境','给一个 Python 项目提供独立的包安装环境，减少项目间的依赖冲突。'],
 'type hint':['类型提示','在代码中说明值预期的类型，帮助工具检查；Python 不会仅凭提示自动强制类型。'],
 'type annotation':['类型标注','写在变量、参数或返回值旁的类型说明，供工具或框架使用。'],
 'asynchronous':['异步','等待某个操作时，允许程序继续安排其他工作；不等同于多线程或并行。'],
 'coroutine':['协程','可以暂停并在之后恢复的计算过程，常用于组织异步任务。'],
 'namespace':['命名空间','管理名称与对象对应关系的范围，让不同范围可以使用相同名称。'],
 'middleware':['中间件','在请求到达业务代码前或响应返回后，统一处理认证、日志等逻辑的组件。'],
 'serialization':['序列化','把内存中的数据转换为可以保存或传输的形式。'],
 'deserialization':['反序列化','把保存或传输的数据还原成程序可以操作的结构。'],
 'idempotency':['幂等性','对同一操作执行一次或重复执行，预期产生的最终效果相同。'],
 'polymorphism':['多态','不同对象可以通过同一种接口表现出各自的行为。'],
 'context manager':['上下文管理器','在进入和退出一段代码时自动管理资源，例如 Python 的 with 语句关闭文件。'],
 'garbage collection':['垃圾回收','自动回收程序不再使用的对象占据的内存。'],
 'race condition':['竞态条件','多个操作的执行时序影响结果，可能让结果不稳定。'],
 'deadlock':['死锁','多个任务互相等待对方持有的资源，导致都无法继续。'],
 'event loop':['事件循环','不断调度就绪的任务和事件回调，常用于异步程序。'],
 'regular expression':['正则表达式','用模式描述要匹配的文本，例如筛选符合格式的字符串。'],
 'hash table':['哈希表','借助哈希函数定位键值对的数据结构，通常能快速查找。'],
 'load balancer':['负载均衡器','把请求分配给多个服务实例，减少单个实例的压力。'],
 'load balancing':['负载均衡','把工作分配给多个服务实例，避免压力集中在单个实例。'],
 'reverse proxy':['反向代理','代表后端服务接收请求，再转发到实际处理请求的服务器。'],
 'distributed system':['分布式系统','多个通过网络协作的计算节点共同完成任务的系统。'],
};
export function localExplanation(c:LocalCandidate,profile:Profile):Concept|undefined {
 if(c.kind==='code'||c.kind==='command'||!/(软件|编程|计算机|software|programming|computer)/i.test(profile.domain))return;
 const key=c.anchor.toLowerCase().replace(/s$/,'');const entry=entries[c.anchor.toLowerCase()]??entries[key];if(!entry)return;
 // Explicit alternative definitions must be interpreted from context, not overwritten by the dictionary.
 if(c.kind==='abbreviation'&&c.context.includes(`(${c.anchor})`)&&!c.context.toLowerCase().includes((entry[2]??'').toLowerCase()))return;
 if(c.kind==='abbreviation'&&/\b(?:stands for|means|short for|refers to)\b/i.test(c.context))return;
 return {anchor:c.anchor,category:c.kind==='abbreviation'?'缩写':'术语',meaning:entry[0],summary:entry[1],expansion:entry[2]??'',ambiguity:'',evidence:'内置通用释义 · 无需 AI 请求；具体语境可点击深入理解。',parts:[]};
}
