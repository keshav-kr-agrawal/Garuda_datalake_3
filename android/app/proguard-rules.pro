# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# --- NHAI Hackathon 7.0 Proguard Optimization Settings ---

# 1. Enable optimization and aggressive code shrinking
-repackageclasses 'com.nhai.datalake.obf'
-allowaccessmodification

# 2. Keep TensorFlow Lite classes (to prevent native linking errors)
-keep class org.tensorflow.lite.** { *; }
-dontwarn org.tensorflow.lite.**

# 3. Keep ObjectBox database classes
-keep class io.objectbox.** { *; }
-dontwarn io.objectbox.**
-keep class * extends io.objectbox.BoxStore { *; }
-keep class * extends io.objectbox.relation.RelationInfo { *; }

# 4. Keep HermesModule and React Native JNI classes
-keepclassmembers class * extends com.facebook.react.bridge.ReactContextBaseJavaModule {
  @com.facebook.react.bridge.ReactMethod *;
}
-keep class com.facebook.react.turbomodule.** { *; }
-keep class com.facebook.jni.** { *; }
-keep class com.facebook.react.bridge.queue.MessageQueueThreadImpl { *; }
-keep class com.facebook.react.bridge.queue.MessageQueueThread { *; }
-dontwarn com.facebook.react.**
-dontwarn com.facebook.jni.**
