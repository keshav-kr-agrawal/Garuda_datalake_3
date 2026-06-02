cmake_minimum_required(VERSION 3.10.2)

project("clahe_filter_jni")

# Add the C++ source file representing our Contrast Limited Adaptive Histogram Equalization
add_library(
    clahe_filter_jni
    SHARED
    ../../src/native/claheFilter.cpp
)

# Find NDK logging libraries
find_library(
    log-lib
    log
)

# Link native log and graphic libraries for frame manipulation
target_link_libraries(
    clahe_filter_jni
    ${log-lib}
    jnigraphics
)
