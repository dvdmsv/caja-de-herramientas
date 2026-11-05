import {PATRONES} from './patrones-generados';
export interface Coincidencia {inicio:number;fin:number;tipo:string}
const letras='TRWAGMYFPDXBNJZSQVHLCKE',nd=/\p{Nd}/u;
function digito(c:string):string {
  if(/[0-9]/.test(c))return c;
  if(!nd.test(c))return c;
  const code=c.codePointAt(0)!;let first=code;
  while(first>0&&nd.test(String.fromCodePoint(first-1)))first--;
  return String((code-first)%10);
}
const normalizarDigitos=(s:string)=>[...s].map(digito).join('');
export function validar(tipo:string,texto:string):boolean {
  const s=normalizarDigitos(texto),limpio=texto.replace(/[^0-9A-Za-z]/g,'').toUpperCase(),digits=s.replace(/\D/g,'');
  if(tipo==='dni')return digits.length===8&&letras[Number(digits)%23]===s.trim().at(-1)?.toUpperCase();
  if(tipo==='nie')return /^[XYZ][0-9]{7}[A-Z]$/.test(limpio)&&letras[Number('XYZ'.indexOf(limpio[0])+limpio.slice(1,8))%23]===limpio[8];
  if(tipo==='cif') {
    if(!/^[ABCDEFGHJNPQRSUVW][0-9]{7}[0-9A-J]$/.test(limpio))return false;
    let sum=0;
    for(let i=1;i<8;i++){const n=Number(limpio[i])*(i%2?2:1);sum+=Math.floor(n/10)+n%10;}
    const control=(10-sum%10)%10,c=limpio[8];
    return 'PQRSNW'.includes(limpio[0])?c==='JABCDEFGHI'[control]:'ABEH'.includes(limpio[0])?c===String(control):c===String(control)||c==='JABCDEFGHI'[control];
  }
  if(tipo==='iban') {
    if(limpio.length<15||limpio.length>34)return false;
    const numero=[...(limpio.slice(4)+limpio.slice(0,4))].map(c=>/[0-9]/.test(c)?c:String(c.charCodeAt(0)-55)).join('');
    return BigInt(numero)%97n===1n;
  }
  if(tipo==='tarjeta') {
    if(digits.length<13||digits.length>19)return false;
    let total=0;
    [...digits].reverse().forEach((c,i)=>{let n=Number(c)*(i%2?2:1);if(n>9)n-=9;total+=n;});
    return total%10===0;
  }
  return true;
}
// Python usa dígitos Unicode. Mantenerlos también en clases y negaciones.
function unicodeDigitos(s:string):string{return s.replace(/\\d/g,'\\p{Nd}');}
const patrones=PATRONES.map(p=>({...p,regex:new RegExp(unicodeDigitos(p.expresion),'gu'+(p.ignorarCaso?'i':''))}));

/** Sintaxis JavaScript Unicode; admite además las banderas iniciales que usa el constructor. */
export function compilarPatron(texto:string):RegExp {
  if([...texto].length>200)throw new Error('La expresión no puede pasar de 200 caracteres.');
  let flags='gu',s=texto;
  const prefijo=/^\(\?([ims]+)\)/.exec(s);
  if(prefijo){flags+=[...new Set(prefijo[1])].join('');s=s.slice(prefijo[0].length);}
  // El constructor compartido escapa el guion como Python. En modo Unicode
  // JavaScript exige un escape hexadecimal fuera de una clase de caracteres.
  s=s.replace(/\\([\s\S])/g,(_match,c:string)=>c==='-'?'\\x2d':'\\'+c);
  try{return new RegExp(s,flags);}
  catch{throw new Error('La expresión no es válida. En Android se utiliza sintaxis JavaScript Unicode, con banderas iniciales (?i), (?m) y (?s).');}
}
function* buscar(regex:RegExp,texto:string):Generator<RegExpMatchArray> {
  regex.lastIndex=0;let total=0;
  for(const m of texto.matchAll(regex))if(m[0].length) {
    if(++total>50_000)throw new Error('La expresión encuentra más de 50000 datos. Afínala o divide el PDF.');
    yield m;
  }
}
export function coincidencias(texto:string,tipos:Set<string>,propio?:RegExp):Coincidencia[] {
  const todas:(Coincidencia&{orden:number})[]=[];
  patrones.forEach((p,orden)=>{
    if(!tipos.has(p.tipo))return;
    for(const match of buscar(p.regex,texto))if(validar(p.tipo,match[0]))todas.push({inicio:match.index!,fin:match.index!+match[0].length,tipo:p.tipo,orden});
  });
  if(propio)for(const match of buscar(propio,texto))todas.push({inicio:match.index!,fin:match.index!+match[0].length,tipo:'propio',orden:patrones.length});
  todas.sort((a,b)=>(b.fin-b.inicio)-(a.fin-a.inicio)||a.orden-b.orden||a.inicio-b.inicio);
  const elegidas:Coincidencia[]=[];
  for(const c of todas) {
    let lo=0,hi=elegidas.length;
    while(lo<hi){const mid=(lo+hi)>>>1;if(elegidas[mid].inicio<c.inicio)lo=mid+1;else hi=mid;}
    if((lo>0&&elegidas[lo-1].fin>c.inicio)||(lo<elegidas.length&&elegidas[lo].inicio<c.fin))continue;
    elegidas.splice(lo,0,{inicio:c.inicio,fin:c.fin,tipo:c.tipo});
  }
  return elegidas;
}
export function ajustes(o:Record<string,unknown>):{tipos:Set<string>;propio?:RegExp} {
  const tipos=o['tipos']??[],texto=o['patron']??'';
  if(!Array.isArray(tipos)||tipos.some(t=>!PATRONES.some(p=>p.tipo===t)))throw new Error('La lista de tipos de dato no es válida.');
  if(typeof texto!=='string')throw new Error('La expresión no es válida.');
  const patron=texto.trim();
  if(!tipos.length&&!patron)throw new Error('Marca algún tipo de dato o escribe una expresión propia.');
  return {tipos:new Set(tipos),propio:patron?compilarPatron(patron):undefined};
}
export function probarPatron(o:Record<string,unknown>) {
  const texto=o['texto']??'',patron=o['patron']??'';
  if(typeof texto!=='string'||typeof patron!=='string')throw new Error('La prueba no es válida.');
  if([...texto].length>5000)throw new Error('El texto de prueba no puede pasar de 5000 caracteres.');
  if(!patron.trim())throw new Error('Escribe una expresión para probarla.');
  const regex=compilarPatron(patron.trim());let total=0;
  const lineas=texto.split('\n').map(linea=>{
    const trozos:{texto:string;coincide:boolean}[]=[];let desde=0;
    for(const c of coincidencias(linea,new Set(),regex)) {
      if(c.inicio>desde)trozos.push({texto:linea.slice(desde,c.inicio),coincide:false});
      trozos.push({texto:linea.slice(c.inicio,c.fin),coincide:true});desde=c.fin;total++;
    }
    if(desde<linea.length||!trozos.length)trozos.push({texto:linea.slice(desde),coincide:false});
    return trozos;
  });
  return {total,lineas};
}
