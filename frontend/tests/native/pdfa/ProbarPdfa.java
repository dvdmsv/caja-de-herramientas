package io.github.dvdmsv.cajadeherramientas;
import java.io.*;
import java.nio.file.*;
import java.util.concurrent.atomic.AtomicBoolean;
public class ProbarPdfa {
 public static void main(String[] args) throws Exception {
  File libs=new File(args[0]),dir=new File(args[1]);
  Files.copy(Paths.get(args[2]),new File(dir,"srgb.icc").toPath(),StandardCopyOption.REPLACE_EXISTING);
  String path=new File(dir,"srgb.icc").getAbsolutePath().replace("\\","\\\\").replace("(","\\(").replace(")","\\)");
  String ps="%!\n[/_objdef {icc} /type /stream /OBJ pdfmark\n[{icc} << /N 3 >> /PUT pdfmark\n[{icc} ("+path+") (r) file /PUT pdfmark\n[/_objdef {intent} /type /dict /OBJ pdfmark\n[{intent} << /Type /OutputIntent /S /GTS_PDFA1 /DestOutputProfile {icc} /OutputConditionIdentifier (sRGB) >> /PUT pdfmark\n[{Catalog} << /OutputIntents [ {intent} ] >> /PUT pdfmark\n";
  Files.writeString(new File(dir,"pdfa.ps").toPath(),ps);
  AtomicBoolean cancelado=new AtomicBoolean(args.length>4&&args[4].equals("cancelar"));
  if(args.length>4&&args[4].equals("durante"))new Thread(()->{try{Thread.sleep(150);cancelado.set(true);}catch(Exception e){}}).start();
  MotorGhostscript.convertir(libs,dir,cancelado,args[3]);
  System.out.println("RESULTADO "+new File(dir,"salida.pdf").length());
 }
}
