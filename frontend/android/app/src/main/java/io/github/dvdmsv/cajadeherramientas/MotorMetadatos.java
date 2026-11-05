package io.github.dvdmsv.cajadeherramientas;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONObject;

final class MotorMetadatos {
    static JSONObject ejecutar(File librerias,File trabajo,JSONObject opciones,AtomicBoolean cancelado)throws Exception {
        File ajustes=new File(trabajo,"ajustes.json"),informe=new File(trabajo,"informe.json"),salida=new File(trabajo,"salida.pdf");
        Files.write(ajustes.toPath(),opciones.toString().getBytes(StandardCharsets.UTF_8));
        if(cancelado.get())throw new IOException("Operación cancelada.");
        Process p=new ProcessBuilder(new File(librerias,"libmetadatosrun.so").getAbsolutePath(),
            new File(trabajo,"entrada.pdf").getAbsolutePath(),salida.getAbsolutePath(),ajustes.getAbsolutePath(),informe.getAbsolutePath()).directory(trabajo).redirectErrorStream(true).start();
        p.getOutputStream().close();
        Thread drain=new Thread(()->{try(InputStream in=p.getInputStream()){byte[] b=new byte[4096];while(in.read(b)!=-1){}}catch(IOException ignored){}});
        drain.setDaemon(true);drain.start();long desde=System.nanoTime();
        try {
            while(!p.waitFor(100,TimeUnit.MILLISECONDS)) {
                if(cancelado.get())throw new IOException("Operación cancelada.");
                if(System.nanoTime()-desde>TimeUnit.MINUTES.toNanos(2))throw new IOException("La lectura de metadatos ha superado dos minutos.");
                if(informe.length()>4*1024*1024||salida.length()>250L*1024*1024)throw new IOException("El resultado supera el tamaño permitido.");
            }
            if(cancelado.get())throw new IOException("Operación cancelada.");
            if(p.exitValue()!=0||!informe.isFile()||informe.length()>4*1024*1024)throw new IOException("No se han podido leer o modificar los metadatos de esta imagen.");
            JSONObject result=new JSONObject(new String(Files.readAllBytes(informe.toPath()),StandardCharsets.UTF_8));
            if(!opciones.optBoolean("inspeccionar",false)) {
                if(!salida.isFile()||salida.length()==0||salida.length()>250L*1024*1024)throw new IOException("No se ha podido guardar la imagen.");
                result.put("size",salida.length());
            }
            return result;
        }finally{if(p.isAlive()){p.destroyForcibly();p.waitFor(5,TimeUnit.SECONDS);}p.getInputStream().close();drain.join(1000);}
    }
}
