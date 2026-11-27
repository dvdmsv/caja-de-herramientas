package io.github.dvdmsv.cajadeherramientas;

import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.filters.SdkSuppress;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;
import java.io.File;
import java.io.InputStream;
import java.nio.file.Files;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

@RunWith(AndroidJUnit4.class)
@SdkSuppress(minSdkVersion = 28)
public class MetadatosHeicTest {
    @Test public void gpsYFechaSoloEnElOriginal() throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        var app = instrumentation.getTargetContext();
        File motores = new File(app.getApplicationInfo().nativeLibraryDir);
        File trabajo = new File(app.getCacheDir(), UUID.randomUUID().toString());
        assertTrue(trabajo.mkdirs());
        try {
            File original = new File(trabajo, "entrada.pdf"); // Ruta de intercambio del puente.
            try (InputStream entrada = instrumentation.getContext().getAssets().open("gps-fecha.heic")) {
                Files.copy(entrada, original.toPath());
            }
            JSONObject opciones = new JSONObject().put("inspeccionar", true);
            JSONObject informe = MotorMetadatos.ejecutar(motores, trabajo, opciones, new AtomicBoolean());
            assertTrue(informe.getBoolean("ubicacion"));
            JSONArray campos = informe.getJSONArray("campos");
            boolean fecha = false;
            for (int i = 0; i < campos.length(); i++) {
                fecha |= "2026:11:27 10:00:00".equals(campos.getJSONObject(i).getString("texto"));
            }
            assertTrue(fecha);
            File copia = new File(trabajo, "limpia.jpg");
            ImagenesPlugin.convertir(original, copia);
            Files.move(copia.toPath(), original.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            JSONObject limpio = MotorMetadatos.ejecutar(motores, trabajo, opciones, new AtomicBoolean());
            assertFalse(limpio.getBoolean("ubicacion"));
            assertFalse(limpio.getJSONArray("campos").toString().contains("2026:11:27"));
        } finally {
            MotorGhostscript.borrar(trabajo);
        }
    }
}
