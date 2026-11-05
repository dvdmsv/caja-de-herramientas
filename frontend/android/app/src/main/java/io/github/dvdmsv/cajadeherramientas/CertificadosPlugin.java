package io.github.dvdmsv.cajadeherramientas;

import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Arrays;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;

@CapacitorPlugin(name = "Certificados")
public class CertificadosPlugin extends Plugin {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    @PluginMethod
    public void crear(PluginCall call) {
        String password = call.getString("contrasena", "");
        char[] secreto = password.toCharArray();
        executor.execute(() -> {
            try {
                int bits = Integer.parseInt(call.getString("bits", "2048"));
                var r = Certificados.crear(call.getString("nombre", ""),call.getString("organizacion", ""),
                    call.getString("correo", ""),call.getString("pais", "ES"),call.getInt("anos",3),bits,secreto);
                JSObject out = new JSObject();
                out.put("p12",Base64.encodeToString(r.p12,Base64.NO_WRAP));
                out.put("crt","-----BEGIN CERTIFICATE-----\n"+Base64.encodeToString(r.crt,Base64.DEFAULT)+"-----END CERTIFICATE-----\n");
                Arrays.fill(r.p12,(byte)0);
                call.resolve(out);
            } catch (IllegalArgumentException e) { call.reject(e.getMessage()); }
            catch (Exception e) { call.reject("No se ha podido crear el certificado."); }
            finally { Arrays.fill(secreto,'\0'); }
        });
    }
    @Override protected void handleOnDestroy() { executor.shutdownNow(); }
}
