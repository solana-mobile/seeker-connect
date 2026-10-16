package com.solanamobile.seekerconnect.reactnative

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/** Registers the `SeekerConnect` module and the `SeekerConnectButton` view. */
class SeekerConnectPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        listOf(SeekerConnectModule(reactContext))

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
        listOf(SeekerConnectButtonManager())
}
