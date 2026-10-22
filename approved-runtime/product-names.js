// One-time, reversible rename of the current catalogue and its document labels.
export function shortenProductNames(state){
  if(state.compactProductNamesV1)return false;
  const used=new Set(),names=new Map(),oldNames=new Map();
  for(const product of state.products){
    const base=product.name.split(/[—–]/)[0].trim().split(/\s+/).slice(0,2).join(' ')||product.name;
    let name=base,index=2;while(used.has(name))name=base+index++;
    used.add(name);names.set(product.id,name);oldNames.set(product.name,name);product.name=name;
  }
  for(const record of state.records){
    for(const line of record.lines||[])if(names.has(line.product))line.name=names.get(line.product);
    if(['stocktransfer','adjustment'].includes(record.kind)&&oldNames.has(record.title))record.title=oldNames.get(record.title);
  }
  state.compactProductNamesV1=true;return true;
}
export function fitProductNames(root){
  for(const element of root.querySelectorAll('.warehouse-product-name,.pos-table-name strong,.pos-result-copy strong,.document-line-name strong')){
    element.style.fontSize='';element.title=element.textContent.trim();
    let size=parseFloat(getComputedStyle(element).fontSize);
    while(element.scrollWidth>element.clientWidth+1&&size>10){size-=.5;element.style.fontSize=size+'px'}
  }
}
