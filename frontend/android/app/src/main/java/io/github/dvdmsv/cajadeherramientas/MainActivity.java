package io.github.dvdmsv.cajadeherramientas;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DocumentosPlugin.class);
        registerPlugin(CertificadosPlugin.class);
        registerPlugin(GhostscriptPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
