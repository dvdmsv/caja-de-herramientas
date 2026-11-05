package io.github.dvdmsv.cajadeherramientas;

import android.app.Service;
import android.content.Intent;
import android.os.*;
import java.io.*;
import java.util.concurrent.Executors;
import org.libreoffice.kit.*;

/** Un proceso por conversión permite cancelar incluso dentro del importador nativo. */
public class OfficeService extends Service {
    private static native boolean aislarRed();
    private boolean iniciado=false;
    private final java.util.concurrent.ExecutorService executor=Executors.newSingleThreadExecutor();
    private final Messenger messenger=new Messenger(new Handler(Looper.getMainLooper(),message->{
        if(message.what==2){android.os.Process.killProcess(android.os.Process.myPid());return true;}
        if(message.what!=1||iniciado)return true;
        iniciado=true;final Messenger respuesta=message.replyTo;final Bundle datos=message.getData();
        executor.execute(()->convertir(datos,respuesta));return true;
    }));
    @Override public IBinder onBind(Intent intent){return messenger.getBinder();}
    private void copiar(String asset,File destino)throws IOException {
        String[] children=getAssets().list(asset);
        if(children!=null&&children.length>0){if(!destino.isDirectory()&&!destino.mkdirs())throw new IOException("No hay espacio para las fuentes de Office.");for(String child:children)copiar(asset+"/"+child,new File(destino,child));}
        else {File parent=destino.getParentFile();if(!parent.isDirectory()&&!parent.mkdirs())throw new IOException("No hay espacio para Office.");try(InputStream in=getAssets().open(asset);OutputStream out=new FileOutputStream(destino)){byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1)out.write(b,0,n);}}
    }
    private void convertir(Bundle datos,Messenger respuesta) {
        String error=null;
        try {
            File dir=new File(datos.getString("directorio","")).getCanonicalFile();
            File raiz=new File(getCacheDir(),"ghostscript").getCanonicalFile();
            if(!dir.getPath().startsWith(raiz.getPath()+File.separator)||!dir.isDirectory())throw new IOException("La operación no existe.");
            String extension=datos.getString("extension","");
            if(!extension.matches("docx|doc|odt|rtf|txt|xlsx|xls|ods|pptx|ppt|odp"))throw new IOException("El formato Office no está admitido.");
            File entrada=new File(dir,"entrada.pdf"),documento=new File(dir,"documento."+extension),salida=new File(dir,"salida.pdf");
            if(!entrada.renameTo(documento))throw new IOException("No se ha podido preparar el documento.");
            // LibreOffice deja sus temporales (lu*.tmp) en la caché y este proceso
            // se mata al acabar, sin darle ocasión de borrarlos. Office va de uno
            // en uno, así que lo que quede de la conversión anterior ya no es de nadie.
            File[] restos=getCacheDir().listFiles((d,nombre)->nombre.startsWith("lu")&&nombre.endsWith(".tmp"));
            if(restos!=null)for(File resto:restos)MotorGhostscript.borrar(resto);
            System.loadLibrary("office-aislamiento");
            if(!aislarRed())throw new IOException("No se ha podido aislar el motor Office de la red.");
            File data=new File(getApplicationInfo().dataDir);
            copiar("unpack",data);
            File profile=new File(data,"user/registrymodifications.xcu");
            try(OutputStream out=new FileOutputStream(profile)) {
                out.write(("<?xml version=\"1.0\"?><oor:items xmlns:oor=\"http://openoffice.org/2001/registry\"><item oor:path=\"/org.openoffice.Office.Common/Security/Scripting\"><prop oor:name=\"MacroSecurityLevel\" oor:op=\"fuse\"><value>3</value></prop><prop oor:name=\"DisableMacrosExecution\" oor:op=\"fuse\"><value>true</value></prop></item></oor:items>").getBytes(java.nio.charset.StandardCharsets.UTF_8));
            }
            LibreOfficeKit.initializeLibrary();LibreOfficeKit.putenv("SAL_LOG=-WARN-INFO");
            LibreOfficeKit.init(this);
            Office office=new Office(LibreOfficeKit.getLibreOfficeKitHandle());
            office.setMessageCallback((type,payload)->{if(type==20||type==21)office.setDocumentPassword(payload,null);});
            Document doc=office.documentLoad(documento.toURI().toASCIIString());
            if(doc==null)throw new IOException("No se ha podido abrir el documento Office. Comprueba que no esté protegido ni dañado.");
            try{doc.saveAs(salida.toURI().toASCIIString(),"pdf","{\"ExportBookmarks\":{\"type\":\"boolean\",\"value\":\"true\"}}");}
            finally{doc.destroy();}
            if(!salida.isFile()||salida.length()==0||salida.length()>250L*1024*1024)throw new IOException("Office no ha generado un PDF válido dentro del límite de tamaño.");
            try(InputStream in=new FileInputStream(salida)){byte[] b=new byte[5];if(in.read(b)!=5||!java.util.Arrays.equals(b,new byte[]{37,80,68,70,45}))throw new IOException("Office no ha generado un PDF válido.");}
        }catch(Throwable e){error=e.getMessage()==null?"No se ha podido convertir el documento Office.":e.getMessage();}
        try{Message result=Message.obtain(null,3);Bundle b=new Bundle();if(error!=null)b.putString("error",error);result.setData(b);respuesta.send(result);}catch(Exception ignored){}
        new Handler(Looper.getMainLooper()).postDelayed(()->android.os.Process.killProcess(android.os.Process.myPid()),500);
    }
}
