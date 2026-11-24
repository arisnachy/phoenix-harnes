// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { detectFile, inspectPackage, parseDelimited, readZipDirectory } from '../src/client/UniversalFileEngine.tsx'

const utf8=(s:string)=>new TextEncoder().encode(s)
function zip(entries:Record<string,string>):Uint8Array{
  const local:Uint8Array[]=[],central:Uint8Array[]=[]
  let offset=0
  for(const [name,value] of Object.entries(entries)){
    const n=utf8(name),data=utf8(value),h=new Uint8Array(30),c=new Uint8Array(46)
    const hv=new DataView(h.buffer),cv=new DataView(c.buffer)
    hv.setUint32(0,0x04034b50,true);hv.setUint32(18,data.length,true);hv.setUint32(22,data.length,true);hv.setUint16(26,n.length,true)
    cv.setUint32(0,0x02014b50,true);cv.setUint32(20,data.length,true);cv.setUint32(24,data.length,true);cv.setUint16(28,n.length,true);cv.setUint32(42,offset,true)
    local.push(h,n,data);central.push(c,n);offset+=h.length+n.length+data.length
  }
  const end=new Uint8Array(22),ev=new DataView(end.buffer),length=central.reduce((n,b)=>n+b.length,0)
  ev.setUint32(0,0x06054b50,true);ev.setUint16(8,Object.keys(entries).length,true);ev.setUint16(10,Object.keys(entries).length,true)
  ev.setUint32(12,length,true);ev.setUint32(16,offset,true)
  const out=new Uint8Array(offset+length+22);let pos=0
  for(const b of [...local,...central,end]){out.set(b,pos);pos+=b.length}
  return out
}
describe('universal file engine',()=>{
  it('prefers actual signatures to misleading filenames and MIME',()=>{
    expect(detectFile(utf8('%PDF-1.7'),'wrong.html','text/html').mode).toBe('pdf')
    expect(detectFile(Uint8Array.of(137,80,78,71,13,10,26,10),'file.bin','application/octet-stream').mime).toBe('image/png')
    expect(detectFile(utf8('MZ'),'fake.png','image/png').mode).toBe('unsupported')
    expect(detectFile(utf8('<html><h1>Test</h1></html>'),'unknown','application/octet-stream').mode).toBe('html')
    expect(detectFile(utf8('a,b\n1,2'),'test.csv','text/plain').mode).toBe('table')
  })
  it('handles quoted CSV cells and newlines',()=>{
    expect(parseDelimited('a,b\r\n"1,2","a""b"\r\n"line\nbreak",3')).toEqual([['a','b'],['1,2','a"b'],['line\nbreak','3']])
  })
  it('recognizes Office from ZIP internals without relying on extension',async()=>{
    const bytes=zip({'word/document.xml':'<w:document xmlns:w="urn:word"><w:p><w:r><w:t>Hola</w:t></w:r></w:p></w:document>'})
    expect(detectFile(bytes,'renamed.bin','application/octet-stream').mode).toBe('archive')
    expect((await inspectPackage(bytes)).parts[0]?.rows).toEqual([['Hola']])
  })
  it('reads spreadsheet cached values and slide text',async()=>{
    const sheet=zip({'xl/worksheets/sheet1.xml':'<worksheet><row><c><v>42</v></c></row></worksheet>'})
    expect((await inspectPackage(sheet)).parts[0]?.rows).toEqual([['42']])
    const deck=zip({'ppt/slides/slide1.xml':'<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><a:p><a:t>Slide one</a:t></a:p></p:sld>'})
    expect((await inspectPackage(deck)).parts[0]?.rows).toEqual([['Slide one']])
  })
  it('recognizes packaged HTML and companion CSS without extracting to disk',async()=>{
    const result=await inspectPackage(zip({'site/index.html':'<html><link rel="stylesheet" href="style.css"><h1>Hello</h1></html>','site/style.css':'h1{color:red}'}))
    expect(JSON.parse(result.html||'{}').files['site/style.css']).toBe('h1{color:red}')
    expect(readZipDirectory(zip({'../outside.txt':'never extracted'}))[0]?.name).toBe('../outside.txt')
    expect(()=>readZipDirectory(Uint8Array.of(80,75,3,4))).toThrow()
  })
})
