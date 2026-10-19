package com.solanamobile.seekerconnect.reactnative

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.ComposeView
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.uimanager.events.Event
import com.solanamobile.seekerconnect.compose.SeekerConnectButton
import com.solanamobile.seekerconnect.compose.SeekerConnectButtonVariant

/** `<SeekerConnectButton>`: the Compose "… with Seeker" button as a React Native view. */
class SeekerConnectButtonManager : SimpleViewManager<ComposeView>() {
    /** Props of one button instance; Compose state, so prop updates recompose it. */
    internal class Props {
        var variant by mutableStateOf(SeekerConnectButtonVariant.CONNECT)
        var enabled by mutableStateOf(true)
        var darkTheme by mutableStateOf<Boolean?>(null)
    }

    override fun getName() = NAME

    override fun createViewInstance(context: ThemedReactContext): ComposeView = ComposeView(context).apply {
        val props = Props()
        tag = props
        setContent {
            SeekerConnectButton(
                onClick = { dispatchPress(this) },
                variant = props.variant,
                enabled = props.enabled,
                darkTheme = props.darkTheme ?: isSystemInDarkTheme(),
            )
        }
    }

    @ReactProp(name = "variant")
    fun setVariant(view: ComposeView, variant: String?) {
        view.props.variant = if (variant == "sign-in") SeekerConnectButtonVariant.SIGN_IN else SeekerConnectButtonVariant.CONNECT
    }

    @ReactProp(name = "enabled", defaultBoolean = true)
    fun setEnabled(view: ComposeView, enabled: Boolean) {
        view.props.enabled = enabled
    }

    /** "dark" or "light" names the screen's scheme; anything else follows the system. */
    @ReactProp(name = "theme")
    fun setTheme(view: ComposeView, theme: String?) {
        view.props.darkTheme = when (theme) {
            "dark" -> true
            "light" -> false
            else -> null
        }
    }

    override fun getExportedCustomDirectEventTypeConstants(): Map<String, Any> =
        mapOf(PressEvent.NAME to mapOf("registrationName" to "onPress"))

    internal class PressEvent(surfaceId: Int, viewId: Int) : Event<PressEvent>(surfaceId, viewId) {
        override fun getEventName() = NAME

        override fun getEventData(): WritableMap = Arguments.createMap()

        companion object {
            // React Native pairs a direct event `topX` with the prop `onX`.
            const val NAME = "topPress"
        }
    }

    companion object {
        const val NAME = "SeekerConnectButton"

        private val ComposeView.props get() = tag as Props

        private fun dispatchPress(view: ComposeView) {
            val context = view.context as ReactContext
            UIManagerHelper.getEventDispatcherForReactTag(context, view.id)
                ?.dispatchEvent(PressEvent(UIManagerHelper.getSurfaceId(context), view.id))
        }
    }
}
