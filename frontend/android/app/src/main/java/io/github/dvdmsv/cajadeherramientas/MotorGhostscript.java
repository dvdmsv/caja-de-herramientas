package io.github.dvdmsv.cajadeherramientas;

import java.io.*;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/** Motor en proceso independiente; no acepta opciones Ghostscript desde la interfaz. */
final class MotorGhostscript {
    static final long MAX_ENTRADA = 50L*1024*1024, MAX_SALIDA = 250L*1024*1024;
    static List<String> orden(File librerias, File trabajo) {
        return Arrays.asList(new File(librerias,"libgsrun.so").getAbsolutePath(),
            "-q", "-dNOPAUSE", "-dBATCH", "-dSAFER", "-sDEVICE=pdfwrite",
            "-sColorConversionStrategy=Gray", "-dProcessColorModel=/DeviceGray",
            "-dAutoRotatePages=/None", "-sOutputFile="+new File(trabajo,"salida.pdf").getAbsolutePath(),
            "-f", new File(trabajo,"entrada.pdf").getAbsolutePath());
    }
    static void convertir(File librerias, File trabajo, AtomicBoolean cancelado) throws Exception {
        convertir(librerias, trabajo, cancelado, false);
    }
    static void convertir(File librerias, File trabajo, AtomicBoolean cancelado, boolean web) throws Exception {
        convertir(librerias,trabajo,cancelado,web ? "web" : "grises");
    }
    static void convertir(File librerias, File trabajo, AtomicBoolean cancelado, String modo) throws Exception {
        boolean web=modo.equals("web");
        File entrada=new File(trabajo,"entrada.pdf"), salida=new File(trabajo,"salida.pdf");
        if (!entrada.isFile() || entrada.length()==0 || entrada.length()>MAX_ENTRADA)
            throw new IOException("Selecciona un PDF de hasta 50 MB.");
        List<String> command=web ? Arrays.asList(new File(librerias,"libqpdfrun.so").getAbsolutePath(), "--linearize", "--", entrada.getAbsolutePath(), salida.getAbsolutePath()) : orden(librerias,trabajo);
        if(modo.equals("pdfa1")||modo.equals("pdfa2"))command=ordenPdfa(librerias,trabajo,modo.endsWith("1")?1:2);
        ProcessBuilder builder=new ProcessBuilder(command);
        builder.directory(trabajo).redirectErrorStream(true);
        builder.environment().put("LD_LIBRARY_PATH",librerias.getAbsolutePath());
        builder.environment().put("TMPDIR",trabajo.getAbsolutePath());
        builder.environment().remove("GS_OPTIONS");
        if(cancelado.get())throw new IOException("Operación cancelada.");
        Process proceso=builder.start();
        proceso.getOutputStream().close();
        // Drenar sin guardar mensajes que podrían contener datos del documento.
        Thread lector=new Thread(()->{
            try(InputStream in=proceso.getInputStream()) { byte[] buffer=new byte[4096];while(in.read(buffer)!=-1){} }
            catch(IOException ignored){}
        },"ghostscript-salida");
        lector.setDaemon(true);lector.start();
        long inicio=System.nanoTime();
        try {
            while(!proceso.waitFor(100,TimeUnit.MILLISECONDS)) {
                if(cancelado.get())throw new IOException("Operación cancelada.");
                if(System.nanoTime()-inicio>TimeUnit.MINUTES.toNanos(5))throw new IOException("La conversión ha superado cinco minutos.");
                if(salida.length()>MAX_SALIDA)throw new IOException("El resultado supera 250 MB.");
            }
            if(cancelado.get())throw new IOException("Operación cancelada.");
            if((proceso.exitValue()!=0 && !(web && proceso.exitValue()==3)) || !salida.isFile() || salida.length()==0)
                throw new IOException("No se ha podido convertir el PDF. Comprueba que no esté dañado ni protegido con contraseña.");
            if(salida.length()>MAX_SALIDA)throw new IOException("El resultado supera 250 MB.");
            try(InputStream in=new FileInputStream(salida)) {
                byte[] magic=new byte[5];
                if(in.read(magic)!=5 || !Arrays.equals(magic,new byte[]{37,80,68,70,45}))throw new IOException("El motor no ha producido un PDF válido.");
            }
        } finally {
            if(proceso.isAlive()) {proceso.destroyForcibly();proceso.waitFor(5,TimeUnit.SECONDS);}
            proceso.getInputStream().close();lector.join(1000);
        }
    }
    static List<String> ordenPdfa(File librerias, File trabajo, int parte) {
        if(parte!=1&&parte!=2)throw new IllegalArgumentException("Perfil PDF/A no válido.");
        return Arrays.asList(new File(librerias,"libgsrun.so").getAbsolutePath(),
            "-q","-dNOPAUSE","-dBATCH","-dSAFER","-sDEVICE=pdfwrite","-dPDFA="+parte,
            "-dPDFACompatibilityPolicy=2","-sColorConversionStrategy=RGB","-dEmbedAllFonts=true",
            "-dAutoRotatePages=/None","--permit-file-read="+new File(trabajo,"srgb.icc").getAbsolutePath(),
            "-sOutputFile="+new File(trabajo,"salida.pdf").getAbsolutePath(),
            "-f",new File(trabajo,"pdfa.ps").getAbsolutePath(),new File(trabajo,"entrada.pdf").getAbsolutePath());
    }
    static void borrar(File dir) {
        File[] children=dir.listFiles();
        if(children!=null)for(File f:children){if(f.isDirectory())borrar(f);else f.delete();}
        dir.delete();
    }
}
