package io.github.dvdmsv.cajadeherramientas;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.OutputStream;

/** Storage Access Framework: el usuario elige el destino, sin acceso general al disco. */
@CapacitorPlugin(name = "Documentos")
public class DocumentosPlugin extends Plugin {
    private File origen(PluginCall call) throws Exception {
        String ruta = call.getString("ruta", "");
        Uri uri = Uri.parse(ruta);
        if (!"file".equals(uri.getScheme())) throw new Exception("Origen no válido.");
        File archivo = new File(uri.getPath()).getCanonicalFile();
        File carpeta = new File(getContext().getCacheDir(), "exportaciones").getCanonicalFile();
        if (!archivo.getParentFile().equals(carpeta) || !archivo.isFile())
            throw new Exception("El archivo temporal ya no está disponible.");
        return archivo;
    }

    @PluginMethod
    public void guardar(PluginCall call) {
        try {
            origen(call);
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType(call.getString("tipo", "application/octet-stream"));
            intent.putExtra(Intent.EXTRA_TITLE, call.getString("nombre", "documento.pdf"));
            startActivityForResult(call, intent, "destinoElegido");
        } catch (Exception e) { call.reject("No se ha podido abrir el selector de archivos.", e); }
    }

    @ActivityCallback
    private void destinoElegido(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.resolve(new JSObject().put("guardado", false));
            return;
        }
        Uri destino = result.getData().getData();
        getBridge().execute(() -> {
            try (FileInputStream entrada = new FileInputStream(origen(call));
                 OutputStream salida = getContext().getContentResolver().openOutputStream(destino, "wt")) {
                if (salida == null) throw new Exception("No se puede escribir en el destino.");
                byte[] bloque = new byte[64 * 1024];
                int leidos;
                while ((leidos = entrada.read(bloque)) != -1) salida.write(bloque, 0, leidos);
                salida.flush();
                call.resolve(new JSObject().put("guardado", true));
            } catch (Exception e) { call.reject("No se ha podido guardar el archivo. Comprueba el espacio disponible.", e); }
        });
    }
}
