package io.github.dvdmsv.cajadeherramientas;

import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.os.ParcelFileDescriptor;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;
import java.io.*;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

@RunWith(AndroidJUnit4.class)
public class GhostscriptAndroidTest {
    @Test public void motorEmpaquetadoConvierteSinRed() throws Exception {
        var instrumentation=InstrumentationRegistry.getInstrumentation();
        var context=instrumentation.getTargetContext();
        File work=new File(context.getCacheDir(),"test-gs-"+UUID.randomUUID());assertTrue(work.mkdirs());
        try {
            try(InputStream in=instrumentation.getContext().getAssets().open("grises.pdf");OutputStream out=new FileOutputStream(new File(work,"entrada.pdf"))){
                byte[] bytes=new byte[8192];int n;while((n=in.read(bytes))!=-1)out.write(bytes,0,n);
            }
            MotorGhostscript.convertir(new File(context.getApplicationInfo().nativeLibraryDir),work,new AtomicBoolean());
            try(ParcelFileDescriptor fd=ParcelFileDescriptor.open(new File(work,"salida.pdf"),ParcelFileDescriptor.MODE_READ_ONLY);
                PdfRenderer renderer=new PdfRenderer(fd)) {
                assertEquals(1,renderer.getPageCount());
                try(PdfRenderer.Page page=renderer.openPage(0)) {
                    assertEquals(300,page.getWidth());assertEquals(200,page.getHeight());
                    Bitmap bitmap=Bitmap.createBitmap(300,200,Bitmap.Config.ARGB_8888);bitmap.eraseColor(Color.WHITE);
                    page.render(bitmap,null,null,PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
                    int tinta=0;
                    for(int y=0;y<200;y++)for(int x=0;x<300;x++){
                        int color=bitmap.getPixel(x,y);assertEquals(Color.red(color),Color.green(color));assertEquals(Color.green(color),Color.blue(color));
                        if(Color.red(color)<240)tinta++;
                    }
                    assertTrue(tinta>2500);bitmap.recycle();
                }
            }
        }finally{MotorGhostscript.borrar(work);}
    }
}
