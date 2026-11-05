package io.github.dvdmsv.cajadeherramientas;

import android.graphics.Bitmap;
import android.graphics.ImageDecoder;
import android.net.Uri;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;

/**
 * HEIC/HEIF a JPEG. El WebView no los decodifica, Android sí desde la 9
 * (`ImageDecoder`, que además aplica la orientación EXIF). Entra y sale por la
 * carpeta de exportaciones de la caché, como lo que se guarda.
 */
@CapacitorPlugin(name = "Imagenes")
public class ImagenesPlugin extends Plugin {
    /** El mismo tope de 20 megapíxeles que el resto de herramientas de imagen. */
    private static final long MAXIMO_PIXELES = 20_000_000L;

    @PluginMethod
    public void heicAJpeg(PluginCall call) {
        if (Build.VERSION.SDK_INT < 28) {
            call.reject("Para abrir fotos HEIC hace falta Android 9 o posterior. Conviértela a JPG antes.");
            return;
        }
        getBridge().execute(() -> {
            try {
                File carpeta = new File(getContext().getCacheDir(), "exportaciones").getCanonicalFile();
                File origen = new File(Uri.parse(call.getString("ruta", "")).getPath()).getCanonicalFile();
                if (!carpeta.equals(origen.getParentFile()) || !origen.isFile()) throw new Exception("Origen no válido.");
                ImageDecoder.Source fuente = ImageDecoder.createSource(origen);
                Bitmap imagen = ImageDecoder.decodeBitmap(fuente, (decoder, info, src) -> {
                    long pixeles = (long) info.getSize().getWidth() * info.getSize().getHeight();
                    if (pixeles > MAXIMO_PIXELES) {
                        double escala = Math.sqrt((double) MAXIMO_PIXELES / pixeles);
                        decoder.setTargetSize((int) (info.getSize().getWidth() * escala), (int) (info.getSize().getHeight() * escala));
                    }
                    decoder.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE);
                });
                File destino = new File(carpeta, origen.getName() + ".jpg");
                try (FileOutputStream salida = new FileOutputStream(destino)) {
                    if (!imagen.compress(Bitmap.CompressFormat.JPEG, 92, salida)) throw new Exception("No se ha podido escribir el JPEG.");
                } finally { imagen.recycle(); }
                call.resolve(new JSObject().put("ruta", Uri.fromFile(destino).toString()));
            } catch (Exception e) {
                call.reject("No se ha podido abrir la foto HEIC. Puede estar dañada o usar una variante que este teléfono no lee.", e);
            }
        });
    }
}
