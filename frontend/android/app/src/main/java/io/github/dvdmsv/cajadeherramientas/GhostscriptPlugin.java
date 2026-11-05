package io.github.dvdmsv.cajadeherramientas;

import android.util.Base64;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name="Ghostscript")
public class GhostscriptPlugin extends Plugin {
    private volatile String aliasElegido;
    @Override public void load() {com.tom_roush.pdfbox.android.PDFBoxResourceLoader.init(getContext());}
    @PluginMethod public void elegirCertificado(PluginCall call) {
        getActivity().runOnUiThread(()->android.security.KeyChain.choosePrivateKeyAlias(getActivity(),alias->{
            if(alias==null){call.reject("Has cerrado el selector de certificados.","CANCELADO");return;}
            executor.execute(()->{
                try {
                    java.security.cert.X509Certificate[] chain=android.security.KeyChain.getCertificateChain(getContext(),alias);
                    if(chain==null||chain.length==0)throw new IOException("No se ha podido leer el certificado elegido.");
                    aliasElegido=alias;JSObject result=new JSObject();result.put("certificado",Base64.encodeToString(chain[0].getEncoded(),Base64.NO_WRAP));call.resolve(result);
                }catch(Exception e){call.reject(e.getMessage());}
            });
        },new String[]{"RSA","EC","DSA"},null,null,-1,null));
    }
    private FirmasPdf.Identidad identidad(PluginCall call) throws Exception {
        String publico=call.getString("certificado_publico","");
        if(!publico.isEmpty()) {
            if(aliasElegido==null)throw new IOException("Selecciona de nuevo el certificado de Android.");
            java.security.cert.X509Certificate[] chain=android.security.KeyChain.getCertificateChain(getContext(),aliasElegido);
            java.security.PrivateKey key=android.security.KeyChain.getPrivateKey(getContext(),aliasElegido);
            if(chain==null||chain.length==0||key==null||!java.security.MessageDigest.isEqual(chain[0].getEncoded(),Base64.decode(publico,Base64.NO_WRAP)))throw new IOException("El certificado elegido ha cambiado. Selecciónalo de nuevo.");
            return new FirmasPdf.Identidad(key,chain);
        }
        String p12=call.getString("certificado","");
        if(p12.length()>350000)throw new IOException("El certificado supera 256 KB.");
        return FirmasPdf.abrir(Base64.decode(p12,Base64.NO_WRAP),call.getString("contrasena","").toCharArray());
    }
    @PluginMethod public void certificado(PluginCall call) {
        executor.execute(()->{
            try {
                String publico=call.getString("certificado_publico","");
                java.security.cert.X509Certificate cert;
                if(!publico.isEmpty()) {
                    if(publico.length()>350000)throw new IOException("El certificado supera 256 KB.");
                    cert=(java.security.cert.X509Certificate)java.security.cert.CertificateFactory.getInstance("X.509").generateCertificate(new ByteArrayInputStream(Base64.decode(publico,Base64.NO_WRAP)));
                }else cert=identidad(call).cadena[0];
                call.resolve(new JSObject(FirmasPdf.certificado(cert).toString()));
            }catch(Exception e){call.reject("No se ha podido leer el certificado. Comprueba el archivo y la contraseña.");}
        });
    }
    @PluginMethod public void firmas(PluginCall call) {operacionFirma(call,"inspeccionar");}
    @PluginMethod public void firmar(PluginCall call) {operacionFirma(call,"firmar");}
    @PluginMethod public void tiempo(PluginCall call) {operacionFirma(call,"tiempo");}
    @PluginMethod public void metadatos(PluginCall call) {operacionFirma(call,"metadatos");}
    @PluginMethod public void office(PluginCall call) {operacionFirma(call,"office");}
    private void operacionFirma(PluginCall call,String modo) {
        final Trabajo t;
        try {
            t=obtener(call);synchronized(t){if(t.estado!=0||t.cancelado.get())throw new IOException("La entrada ya está cerrada.");t.estado=1;}
        }catch(Exception e){call.reject(e.getMessage());return;}
        executor.execute(()->{
            try {
                JSObject result=new JSObject();
                File entrada=new File(t.dir,"entrada.pdf"),salida=new File(t.dir,"salida.pdf");
                if(modo.equals("office")) {
                    MotorOffice.convertir(getContext(),t.dir,call.getString("extension",""),t.cancelado);
                    result.put("size",salida.length());
                }
                else if(modo.equals("metadatos"))result=new JSObject(MotorMetadatos.ejecutar(new File(getContext().getApplicationInfo().nativeLibraryDir),t.dir,call.getObject("ajustes",new JSObject()),t.cancelado).toString());
                else if(modo.equals("inspeccionar"))result.put("firmas",FirmasPdf.inspeccionar(entrada,t.cancelado));
                else {
                    boolean sello=modo.equals("tiempo");
                    FirmasPdf.Identidad key=sello?null:identidad(call);
                    String motivo=call.getString("motivo",""),lugar=call.getString("lugar","");
                    if(motivo.length()>120||lugar.length()>120)throw new IOException("El motivo y el lugar admiten hasta 120 caracteres.");
                    float[] rect=null;byte[] png=null;
                    JSArray coords=call.getArray("recuadro");
                    if(coords!=null) {
                        if(coords.length()!=4)throw new IOException("El recuadro no es válido.");
                        rect=new float[4];for(int i=0;i<4;i++)rect[i]=(float)coords.getDouble(i);
                        String image=call.getString("apariencia","");if(image.length()>14*1024*1024)throw new IOException("La apariencia es demasiado grande.");
                        png=Base64.decode(image,Base64.NO_WRAP);
                    }
                    SellarPdf.ejecutar(entrada,salida,key,sello,call.getBoolean("sello_tiempo",false),motivo,lugar,call.getInt("pagina",1)-1,rect,png,t.cancelado);
                    result.put("size",salida.length());
                }
                synchronized(t){if(t.cancelado.get())throw new IOException("Operación cancelada.");t.estado=2;call.resolve(result);}
            }catch(Exception e){call.reject(e.getMessage());}
            finally{synchronized(t){t.estado=2;if(t.cancelado.get()){MotorGhostscript.borrar(t.dir);trabajos.values().remove(t);}}}
        });
    }
    private static class Trabajo {
        final File dir;
        final AtomicBoolean cancelado=new AtomicBoolean();
        int estado=0; // recibiendo, convirtiendo, resultado
        Trabajo(File dir){this.dir=dir;}
    }
    private final Map<String,Trabajo> trabajos=new ConcurrentHashMap<>();
    private final ExecutorService executor=Executors.newSingleThreadExecutor();
    private Trabajo obtener(PluginCall call) throws IOException {
        Trabajo t=trabajos.get(call.getString("id",""));
        if(t==null || t.cancelado.get())throw new IOException("La operación ya ha terminado o se ha cancelado.");
        return t;
    }
    @PluginMethod public synchronized void crear(PluginCall call) {
        if(!trabajos.isEmpty()){call.reject("Espera a que termine la operación actual.");return;}
        String id=UUID.randomUUID().toString();
        File root=new File(getContext().getCacheDir(),"ghostscript");
        // Una sesión anterior interrumpida no debe acumular documentos.
        MotorGhostscript.borrar(root);
        File dir=new File(root,id);
        if(!dir.mkdirs()){call.reject("No se ha podido reservar espacio temporal.");return;}
        trabajos.put(id,new Trabajo(dir));
        JSObject result=new JSObject();result.put("id",id);call.resolve(result);
    }
    @PluginMethod public void escribir(PluginCall call) {
        try {
            Trabajo t=obtener(call);
            synchronized(t) {
                if(t.estado!=0 || t.cancelado.get())throw new IOException("La entrada ya está cerrada.");
                String data=call.getString("data","");
                if(data.length()>710000)throw new IOException("El bloque es demasiado grande.");
                byte[] bytes=Base64.decode(data,Base64.NO_WRAP);
                File file=new File(t.dir,"entrada.pdf");
                if(bytes.length>512*1024 || file.length()+bytes.length>MotorGhostscript.MAX_ENTRADA)
                    throw new IOException("El PDF supera 50 MB.");
                try(OutputStream out=new FileOutputStream(file,true)){out.write(bytes);}
            }
            call.resolve();
        } catch(Exception e){call.reject(e.getMessage());}
    }
    @PluginMethod public void grises(PluginCall call) { ejecutar(call, "grises"); }
    @PluginMethod public void linearizar(PluginCall call) { ejecutar(call, "web"); }
    @PluginMethod public void pdfa(PluginCall call) {
        String perfil=call.getString("perfil","2b");
        if(!perfil.equals("1b")&&!perfil.equals("2b")){call.reject("Perfil PDF/A no válido.");return;}
        ejecutar(call,perfil.equals("1b")?"pdfa1":"pdfa2");
    }
    private void ejecutar(PluginCall call, String modo) {
        final Trabajo t;
        try {
            t=obtener(call);
            synchronized(t){if(t.estado!=0 || t.cancelado.get())throw new IOException("La entrada ya está cerrada.");t.estado=1;}
        }catch(Exception e){call.reject(e.getMessage());return;}
        executor.execute(()->{
            try {
                if(modo.startsWith("pdfa")) {
                    try(InputStream in=getContext().getAssets().open("public/assets/pdfa/srgb.icc");OutputStream out=new FileOutputStream(new File(t.dir,"srgb.icc"))) {
                        byte[] bytes=new byte[8192];int n;while((n=in.read(bytes))!=-1)out.write(bytes,0,n);
                    }
                    String path=new File(t.dir,"srgb.icc").getAbsolutePath().replace("\\","\\\\").replace("(","\\(").replace(")","\\)");
                    String ps="%!\n[/_objdef {icc} /type /stream /OBJ pdfmark\n[{icc} << /N 3 >> /PUT pdfmark\n[{icc} ("+path+") (r) file /PUT pdfmark\n[/_objdef {intent} /type /dict /OBJ pdfmark\n[{intent} << /Type /OutputIntent /S /GTS_PDFA1 /DestOutputProfile {icc} /OutputConditionIdentifier (sRGB) >> /PUT pdfmark\n[{Catalog} << /OutputIntents [ {intent} ] >> /PUT pdfmark\n";
                    try(OutputStream out=new FileOutputStream(new File(t.dir,"pdfa.ps"))){out.write(ps.getBytes(java.nio.charset.StandardCharsets.UTF_8));}
                }
                MotorGhostscript.convertir(new File(getContext().getApplicationInfo().nativeLibraryDir),t.dir,t.cancelado,modo);
                synchronized(t){
                    if(t.cancelado.get())throw new IOException("Operación cancelada.");
                    t.estado=2;
                    JSObject result=new JSObject();result.put("size",new File(t.dir,"salida.pdf").length());call.resolve(result);
                }
            }catch(Exception e){call.reject(e.getMessage());}
            finally{synchronized(t){t.estado=2;if(t.cancelado.get()){MotorGhostscript.borrar(t.dir);trabajos.values().remove(t);}}}
        });
    }
    @PluginMethod public void leer(PluginCall call) {
        try {
            Trabajo t=obtener(call);
            synchronized(t){
                if(t.estado!=2 || t.cancelado.get())throw new IOException("El resultado no está disponible.");
                int offset=call.getInt("offset",-1);
                try(RandomAccessFile file=new RandomAccessFile(new File(t.dir,"salida.pdf"),"r")) {
                    if(offset<0 || offset>=file.length())throw new IOException("La posición no es válida.");
                    byte[] bytes=new byte[(int)Math.min(512*1024,file.length()-offset)];file.seek(offset);file.readFully(bytes);
                    JSObject result=new JSObject();result.put("data",Base64.encodeToString(bytes,Base64.NO_WRAP));call.resolve(result);
                }
            }
        }catch(Exception e){call.reject(e.getMessage());}
    }
    @PluginMethod public void liberar(PluginCall call) {
        Trabajo t=trabajos.get(call.getString("id",""));
        if(t!=null)synchronized(t){t.cancelado.set(true);if(t.estado!=1){MotorGhostscript.borrar(t.dir);trabajos.values().remove(t);}}
        call.resolve();
    }
    @Override protected void handleOnDestroy() {
        for(Trabajo t:trabajos.values())synchronized(t){t.cancelado.set(true);if(t.estado!=1)MotorGhostscript.borrar(t.dir);}
        trabajos.clear();executor.shutdown();
    }
}
