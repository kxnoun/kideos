package com.kideos.app

import android.content.pm.ActivityInfo
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager

// Kideos: window controls for the kid app (JS: src/device.ts)
//  - setLandscapeOnly: young mode stays landscape (either way up); older kids can rotate
//  - hideSystemBars: hide the bars again (e.g. after YouTube's fullscreen gives them back)
class KideosWindowModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName(): String = "KideosWindow"

  @ReactMethod
  fun setLandscapeOnly(on: Boolean) {
    val activity = reactApplicationContext.currentActivity ?: return
    activity.runOnUiThread {
      activity.requestedOrientation =
          if (on) ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
          else ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
    }
  }

  @ReactMethod
  fun hideSystemBars() {
    val activity = reactApplicationContext.currentActivity as? MainActivity ?: return
    activity.runOnUiThread { activity.hideSystemBars() }
  }
}

class KideosWindowPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
      listOf(KideosWindowModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<in Nothing, in Nothing>> =
      emptyList()
}
