/** Port del tratamiento de iluminación de backend/api/escaneo.py. */
export function limpiarEscaneo(rgba: Uint8ClampedArray, ancho: number, alto: number,
                              modo: string, intensidad: number): Uint8ClampedArray {
  if (!['blanco-y-negro', 'gris', 'color'].includes(modo)) throw new Error('El modo de escáner no es válido.');
  if (!Number.isInteger(intensidad) || intensidad < 0 || intensidad > 100) throw new Error('La intensidad debe estar entre 0 y 100.');
  if (!Number.isInteger(ancho) || !Number.isInteger(alto) || ancho < 1 || alto < 1 || ancho * alto > 20_000_000 || rgba.length !== ancho * alto * 4) throw new Error('Las dimensiones de la imagen no son válidas.');
  const salida = new Uint8ClampedArray(rgba.length);
  const escala = Math.max(1, Math.max(ancho, alto) / 400);
  const w = Math.max(1, Math.floor(ancho / escala)), h = Math.max(1, Math.floor(alto / escala));
  const puntoBlanco = 0.88 - 0.28 * intensidad / 100;
  const canales = modo === 'color' ? [0, 1, 2] : [-1];
  for (const canal of canales) {
    const valor = (x: number, y: number) => {
      const i = (y * ancho + x) * 4, a = rgba[i + 3] / 255;
      const v = canal < 0 ? (rgba[i] + rgba[i + 1] + rgba[i + 2]) / 3 : rgba[i + canal];
      return v * a + 255 * (1 - a);
    };
    const hist = new Uint32Array(256);
    for (let y = 0; y < alto; y++) for (let x = 0; x < ancho; x++) hist[Math.floor(valor(x, y))]++;
    let acumulado = 0, papel = 255;
    for (let n = 0; n < 256; n++) { acumulado += hist[n]; if (acumulado >= ancho * alto * 0.92) { papel = n; break; } }
    const suelo = Math.max(1, papel * 0.55), pequena = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const sx = Math.max(0, (x + 0.5) * ancho / w - 0.5), sy = Math.max(0, (y + 0.5) * alto / h - 0.5);
      const ix = Math.floor(sx), iy = Math.floor(sy), dx = sx - ix, dy = sy - iy;
      pequena[y*w+x] = (valor(ix,iy)*(1-dx)+valor(Math.min(ix+1,ancho-1),iy)*dx)*(1-dy)
        +(valor(ix,Math.min(iy+1,alto-1))*(1-dx)+valor(Math.min(ix+1,ancho-1),Math.min(iy+1,alto-1))*dx)*dy;
    }
    let fondo = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let max = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) max = Math.max(max, pequena[Math.max(0,Math.min(h-1,y+dy))*w+Math.max(0,Math.min(w-1,x+dx))]);
      fondo[y*w+x] = max;
    }
    // Gaussian separable, sigma 12, truncado a tres desviaciones.
    const pesos = Array.from({ length: 73 }, (_, i) => Math.exp(-((i-36)**2)/(2*12**2)));
    const suma = pesos.reduce((a,b)=>a+b,0);
    for (const vertical of [false, true]) {
      const siguiente = new Float32Array(w*h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let v = 0;
        for (let k = -36; k <= 36; k++) v += pesos[k+36] * fondo[Math.max(0,Math.min(h-1,y+(vertical?k:0)))*w+Math.max(0,Math.min(w-1,x+(vertical?0:k)))];
        siguiente[y*w+x] = v/suma;
      }
      fondo = siguiente;
    }
    for (let y = 0; y < alto; y++) for (let x = 0; x < ancho; x++) {
      const fx = Math.max(0,(x+0.5)*w/ancho-0.5), fy = Math.max(0,(y+0.5)*h/alto-0.5);
      const ix = Math.floor(fx), iy = Math.floor(fy), dx = fx-ix, dy = fy-iy;
      const a = fondo[iy*w+ix]*(1-dx)+fondo[iy*w+Math.min(w-1,ix+1)]*dx;
      const b = fondo[Math.min(h-1,iy+1)*w+ix]*(1-dx)+fondo[Math.min(h-1,iy+1)*w+Math.min(w-1,ix+1)]*dx;
      const plano = Math.min(1,valor(x,y)/Math.max(suelo,a*(1-dy)+b*dy)/puntoBlanco);
      const byte = modo === 'blanco-y-negro' ? (plano >= 0.5 ? 255 : 0) : Math.floor(plano*255);
      const i = (y*ancho+x)*4;
      if (canal < 0) salida[i] = salida[i+1] = salida[i+2] = byte;
      else salida[i+canal] = byte;
      salida[i+3] = 255;
    }
  }
  return salida;
}
