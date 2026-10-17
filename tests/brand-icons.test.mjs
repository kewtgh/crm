import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import sharp from 'sharp';

test('brand PNGs have opaque white backgrounds and declared dimensions',async()=>{
  for(const [file,width,height] of [
    ['favicon-16x16.png',16,16],['favicon-32x32.png',32,32],
    ['favicon-192x192.png',192,192],['apple-touch-icon.png',180,180],
    ['icon-512x512.png',512,512],['brand/ewaya-social.png',512,512],
    ['brand/weiai-logo-800x240.png',800,240],
  ]){
    const image=sharp(await readFile(`public/${file}`));
    const metadata=await image.metadata();
    assert.equal(metadata.width,width,file);assert.equal(metadata.height,height,file);
    assert.equal(metadata.hasAlpha,false,file);
    const {data,info}=await image.raw().toBuffer({resolveWithObject:true});
    for(const pixel of [0,width-1,(height-1)*width,height*width-1]){
      assert.deepEqual([...data.subarray(pixel*info.channels,pixel*info.channels+3)],[255,255,255],file);
    }
  }
});

test('default favicon contains real white-background ICO frames',async()=>{
  const ico=await readFile('public/favicon.ico');
  assert.equal(ico.readUInt16LE(0),0);assert.equal(ico.readUInt16LE(2),1);
  assert.equal(ico.readUInt16LE(4),3);
  for(const [index,size] of [16,32,48].entries()){
    const entry=6+index*16;assert.equal(ico[entry],size);assert.equal(ico[entry+1],size);
    const length=ico.readUInt32LE(entry+8),offset=ico.readUInt32LE(entry+12);
    const metadata=await sharp(ico.subarray(offset,offset+length)).metadata();
    assert.equal(metadata.width,size);assert.equal(metadata.height,size);assert.equal(metadata.hasAlpha,false);
  }
});

test('homepage shortcuts have public square icons, a stable identity and dashboard URL',async()=>{
  const manifest=JSON.parse(await readFile('public/site.webmanifest','utf8'));
  assert.equal(manifest.id,'/');assert.equal(manifest.start_url,'/dashboard');
  assert.equal(manifest.background_color,'#ffffff');
  assert.deepEqual(manifest.icons.map(icon=>icon.sizes),['192x192','512x512']);
  for(const icon of manifest.icons){
    const url=new URL(icon.src,'https://example.test');
    const metadata=await sharp(await readFile(`public${url.pathname}`)).metadata();
    assert.equal(`${metadata.width}x${metadata.height}`,icon.sizes);
  }
});
