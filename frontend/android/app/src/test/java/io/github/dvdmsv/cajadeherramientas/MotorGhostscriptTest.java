package io.github.dvdmsv.cajadeherramientas;

import org.junit.*;
import org.junit.rules.TemporaryFolder;
import static org.junit.Assert.*;
import java.io.*;
import java.nio.file.Files;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

public class MotorGhostscriptTest {
    @Rule public TemporaryFolder temp=new TemporaryFolder();
    private File librerias(String script) throws Exception {
        File dir=temp.newFolder();File executable=new File(dir,"libgsrun.so");
        Files.write(executable.toPath(),("#!/bin/sh\n"+script).getBytes(java.nio.charset.StandardCharsets.UTF_8));assertTrue(executable.setExecutable(true));return dir;
    }
    private File entrada(String data) throws Exception {
        File dir=temp.newFolder();Files.write(new File(dir,"entrada.pdf").toPath(),data.getBytes(java.nio.charset.StandardCharsets.UTF_8));return dir;
    }
    @Test public void salidaNoPdfSeRechaza() throws Exception {
        try{MotorGhostscript.convertir(librerias("printf 'error' > salida.pdf\n"),entrada("%PDF-test"),new AtomicBoolean());fail();}
        catch(IOException e){assertTrue(e.getMessage().contains("PDF válido"));}
    }
    @Test public void falloDelMotorNoPublicaResultado() throws Exception {
        try{MotorGhostscript.convertir(librerias("printf 'incompleto' > salida.pdf\nexit 1\n"),entrada("%PDF-test"),new AtomicBoolean());fail();}
        catch(IOException e){assertTrue(e.getMessage().contains("convertir"));}
    }
    @Test public void cancelarDetieneProcesoEnCurso() throws Exception {
        File work=entrada("%PDF-test"),libs=librerias("echo $$ > pid\nwhile :; do :; done\n");
        AtomicBoolean cancelado=new AtomicBoolean();ExecutorService executor=Executors.newSingleThreadExecutor();
        try {
            Future<?> result=executor.submit(()->{try{MotorGhostscript.convertir(libs,work,cancelado);throw new AssertionError();}
                catch(Exception e){assertTrue(e.getMessage().contains("cancelada"));}});
            long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(3);
            File pid=new File(work,"pid");while(!pid.exists()&&System.nanoTime()<deadline)Thread.sleep(10);
            assertTrue(pid.exists());cancelado.set(true);result.get(3,TimeUnit.SECONDS);
            long id=Long.parseLong(new String(Files.readAllBytes(pid.toPath()),java.nio.charset.StandardCharsets.UTF_8).trim());
            assertFalse(new File("/proc/"+id).exists());
        }finally{cancelado.set(true);executor.shutdownNow();}
    }
    @Test public void canceladoAntesDeArrancarNoEjecuta() throws Exception {
        File work=entrada("%PDF-test");
        try{MotorGhostscript.convertir(librerias("touch arrancado\n"),work,new AtomicBoolean(true));fail();}
        catch(IOException e){assertTrue(e.getMessage().contains("cancelada"));}
        assertFalse(new File(work,"arrancado").exists());
    }
}
