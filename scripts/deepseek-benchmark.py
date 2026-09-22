"""Small opt-in live benchmark. Key is read without echo and never saved.

Uses only synthetic tutorial snippets, at most six requests, no paid retries.
Run from the repository root with Python 3. Results contain no credentials.
"""
import argparse
import subprocess
import getpass
import json
import pathlib
import re
import time
import urllib.request
import urllib.error

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source-ref',help='Optional Git revision supplying the prompt, e.g. 2f07988')
args=parser.parse_args()
source = subprocess.check_output(['git','show',args.source_ref+':src/core/ai.ts'],text=True) if args.source_ref else pathlib.Path('src/core/ai.ts').read_text()
key = getpass.getpass('Temporary DeepSeek key (not saved): ')
system = re.search(r'const SYSTEM = `([^`]+)`', source).group(1)
contract = re.search(r"analyze: '([^']+)'", source).group(1)
system += '\n任务：analyze。结构：' + contract
system += '\n' + re.search(r"request.operation==='analyze'\?'([^']+)'",source).group(1)
examples = [
 ('lifespan', 'Use the lifespan function to initialize resources before the application accepts requests and release them on shutdown.'),
 ('backpressure', 'When a consumer is slower than a producer, backpressure prevents an unbounded queue from exhausting memory.'),
 ('ASGI', 'ASGI is the asynchronous server gateway interface between a Python web server and an application.'),
 ('dependency override', 'A dependency override replaces the real database dependency with a test double during tests.'),
 ('connection pool', 'Reuse database connections from a connection pool instead of opening a new connection for every request.'),
 ('DR', 'DR restores service in a secondary region after the primary region becomes unavailable.'),
 ('fixture', 'A pytest fixture prepares a temporary database and cleans it up after each test.'),
 ('idempotency key', 'Reuse the same idempotency key when retrying a payment request to avoid creating duplicate payments.'),
]
results = []
for label, count, disabled, streaming in [('baseline-8',8,False,False), ('nonthinking-8',8,True,False), ('stream-4-a',4,True,True), ('stream-2-a',2,True,True), ('stream-4-b',4,True,True), ('stream-2-b',2,True,True)]:
    candidates = [dict(id=f'c{i}',anchor=a,kind='abbreviation' if a.isupper() else 'term',heading='Application lifecycle',context=c) for i,(a,c) in enumerate(examples[:count])]
    body = dict(model='deepseek-flash',messages=[dict(role='system',content=system),dict(role='user',content=json.dumps(dict(operation='analyze',profile=dict(domain='软件开发',level='入门'),title='Python web application tutorial',candidates=candidates),ensure_ascii=False))],temperature=0.2,max_tokens=2200 if count==8 else 900,stream=streaming)
    if disabled: body['thinking'] = dict(type='disabled')
    if streaming: body['stream_options'] = dict(include_usage=True)
    request = urllib.request.Request('https://api.deepseek.com/chat/completions',data=json.dumps(body).encode(),headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'})
    start=time.monotonic(); row=dict(label=label,candidates=count); raw=''; usage=None; first=None; first_item=None; finish=None
    try:
        with urllib.request.urlopen(request,timeout=40) as response:
            row['headers_ms']=round((time.monotonic()-start)*1000)
            if streaming:
                for line in response:
                    if time.monotonic()-start>50: raise TimeoutError()
                    line=line.decode().strip()
                    if not line.startswith('data:'): continue
                    value=line[5:].strip()
                    if value=='[DONE]': break
                    chunk=json.loads(value)
                    usage=chunk.get('usage') or usage
                    choice=(chunk.get('choices') or [{}])[0]
                    finish=choice.get('finish_reason') or finish
                    part=choice.get('delta',{}).get('content') or ''
                    if part and first is None: first=round((time.monotonic()-start)*1000)
                    raw+=part
                    if first_item is None:
                        for match in re.finditer(r'\{',raw):
                            try: item,_=json.JSONDecoder().raw_decode(raw[match.start():])
                            except ValueError: continue
                            if item.get('id') in {c['id'] for c in candidates} and item.get('summary'):
                                first_item=round((time.monotonic()-start)*1000); break
            else:
                chunk=json.load(response); usage=chunk.get('usage'); choice=chunk['choices'][0]; raw=choice['message'].get('content') or ''; finish=choice.get('finish_reason')
                first=round((time.monotonic()-start)*1000) if raw else None
        row.update(total_ms=round((time.monotonic()-start)*1000),first_content_ms=first,first_item_ms=first_item or first,finish=finish,usage=usage)
        try: row['items']=json.loads(raw).get('items',[])
        except ValueError: row['parse_error']=True
    except Exception as error:
        row.update(total_ms=round((time.monotonic()-start)*1000),error=type(error).__name__,http_status=getattr(error,'code',None))
    results.append(row)
    print(json.dumps({k:v for k,v in row.items() if k!='items'},ensure_ascii=False),flush=True)
    if row.get('http_status') in (401,402,403,429): break
key = None
pathlib.Path('artifacts').mkdir(exist_ok=True)
pathlib.Path('artifacts/deepseek-benchmark.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
