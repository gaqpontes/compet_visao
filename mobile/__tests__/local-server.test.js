/** @jest-environment node */
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createLocalServer} = require('../scripts/serve-local.cjs');
describe('servidor local sem endpoints de envio', () => {
  let server, directory, port;
  beforeAll(async () => {
    directory=fs.mkdtempSync(path.join(os.tmpdir(),'repcounter-security-'));
    fs.writeFileSync(path.join(directory,'index.html'),'<html>local</html>');
    server=createLocalServer(directory);
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve)); port=server.address().port;
  });
  afterAll(async () => {await new Promise(resolve => server.close(resolve)); fs.rmSync(directory,{recursive:true});});
  const request=(method,pathname,headers={})=>new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port,path:pathname,method,headers},response=>{
      let body='';response.on('data',data=>body+=data);response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body}));
    });req.on('error',reject);req.end();
  });
  it('serve apenas o export com política de rede e proteção contra iframe', async()=>{
    const result=await request('GET','/'); expect(result.status).toBe(200);expect(result.body).toContain('local');
    expect(result.headers['content-security-policy']).toContain("connect-src 'self'");
    expect(result.headers['content-security-policy'].split(';').find(v=>v.trim().startsWith('script-src'))).not.toContain("'unsafe-inline'");
    expect(result.headers['x-frame-options']).toBe('DENY');
  });
  it.each(['POST','PUT','PATCH','DELETE'])('rejeita envio via %s',async method=>{
    expect((await request(method,'/')).status).toBe(405);
  });
  it('bloqueia traversal e Host/Origin de outra página',async()=>{
    expect((await request('GET','/%2e%2e/package.json')).status).toBe(400);
    expect((await request('GET','/',{host:'evil.example'})).status).toBe(403);
    expect((await request('GET','/',{origin:'https://evil.example'})).status).toBe(403);
    expect((await request('GET','/package.json')).status).toBe(404);
  });
});
