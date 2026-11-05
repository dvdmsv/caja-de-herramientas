package io.github.dvdmsv.cajadeherramientas;
import android.content.*;
import android.os.*;
import java.io.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

final class MotorOffice {
    static void convertir(Context context,File dir,String extension,AtomicBoolean cancelado)throws Exception {
        CompletableFuture<String> terminado=new CompletableFuture<>();AtomicReference<Messenger> remoto=new AtomicReference<>();
        Messenger respuesta=new Messenger(new Handler(Looper.getMainLooper(),m->{if(m.what==3)terminado.complete(m.getData().getString("error"));return true;}));
        ServiceConnection connection=new ServiceConnection(){
            public void onServiceConnected(ComponentName name,IBinder binder) {
                Messenger service=new Messenger(binder);remoto.set(service);
                Message request=Message.obtain(null,cancelado.get()?2:1);request.replyTo=respuesta;
                Bundle b=new Bundle();b.putString("directorio",dir.getAbsolutePath());b.putString("extension",extension);request.setData(b);
                try{service.send(request);}catch(RemoteException e){terminado.complete("No se ha podido iniciar Office.");}
            }
            public void onServiceDisconnected(ComponentName name){terminado.complete("El motor Office se ha cerrado antes de terminar.");}
            public void onNullBinding(ComponentName name){terminado.complete("No se ha podido iniciar Office.");}
        };
        if(cancelado.get())throw new IOException("Operación cancelada.");
        if(!context.bindService(new Intent(context,OfficeService.class),connection,Context.BIND_AUTO_CREATE))throw new IOException("No se ha podido iniciar Office.");
        long desde=System.nanoTime();
        try {
            while(!terminado.isDone()) {
                if(cancelado.get())throw new IOException("Operación cancelada.");
                if(System.nanoTime()-desde>TimeUnit.MINUTES.toNanos(5))throw new IOException("La conversión Office ha superado cinco minutos.");
                if(new File(dir,"salida.pdf").length()>250L*1024*1024)throw new IOException("El PDF supera 250 MB.");
                try{terminado.get(100,TimeUnit.MILLISECONDS);}catch(TimeoutException ignored){}
            }
            if(cancelado.get())throw new IOException("Operación cancelada.");
            String error=terminado.get();if(error!=null)throw new IOException(error);
        }finally{
            Messenger remote=remoto.get();if(remote!=null)try{remote.send(Message.obtain(null,2));}catch(RemoteException ignored){}
            context.unbindService(connection);
        }
    }
}
