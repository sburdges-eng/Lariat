cmake_minimum_required(VERSION 3.20)
project(FloorPlanDesignerKernel CXX)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(SANITIZER_FLAGS "-fsanitize=address,undefined -fno-omit-frame-pointer")
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} ${SANITIZER_FLAGS}")
set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} ${SANITIZER_FLAGS}")

include_directories(${CMAKE_CURRENT_SOURCE_DIR}/include)

add_library(solver STATIC src/solver/newton_raphson.cpp src/solver/jacobian.cpp)
add_library(geom STATIC src/geom/bounding_volume.cpp src/geom/boolean_ops.cpp src/geom/transform.cpp src/geom/curves.cpp src/geom/geodesy.cpp src/geom/clothoid.cpp src/geom/tin.cpp src/geom/octree.cpp src/geom/quadtree.cpp src/geom/selection.cpp src/geom/crs.cpp src/geom/vertical_alignment.cpp src/geom/mass_properties.cpp src/geom/dimensioning.cpp)
add_library(core STATIC src/core/scene_graph.cpp)
add_library(ops STATIC src/ops/pathfinding.cpp src/ops/seating_layout.cpp)
add_library(io STATIC src/io/dxf_parser.cpp)
add_library(apple STATIC src/apple/graphics/scene_object.cpp src/apple/graphics/render_backend.cpp src/apple/graphics/engine.cpp src/apple/graphics/intents_bridge.cpp src/apple/graphics/collaboration.cpp src/apple/graphics/constructs/menu_designer.cpp src/apple/graphics/constructs/floor_plan.cpp src/apple/audio/procedural_synth.cpp src/apple/audio/audio_session.cpp)

# Enforce strict agentic safety protocols ONLY on our targets
target_compile_options(solver PRIVATE -Wall -Wextra -Wpedantic -Werror -O3 -fno-fast-math)
target_compile_options(geom PRIVATE -Wall -Wextra -Wpedantic -Werror -O3 -fno-fast-math)
target_compile_options(io PRIVATE -Wall -Wextra -Wpedantic -Werror -O3 -fno-fast-math)
target_compile_options(ops PRIVATE -Wall -Wextra -Wpedantic -Werror -O3 -fno-fast-math)
target_compile_options(core PRIVATE -Wall -Wextra -Wpedantic -Werror -O3 -fno-fast-math)
target_compile_options(apple PRIVATE -Wall -Wextra -Wpedantic -Werror -O3 -fno-fast-math)

target_link_libraries(solver PRIVATE geom)
target_link_libraries(core PRIVATE geom solver)
target_link_libraries(ops PRIVATE geom core solver)
target_link_libraries(io PRIVATE geom)
target_link_libraries(apple PRIVATE core geom ops)

include(FetchContent)
FetchContent_Declare(
  googletest
  URL https://github.com/google/googletest/archive/03597a01ee50ed33e9dfd640b249b4be3799d395.zip
)
set(gtest_force_shared_crt ON CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(googletest)

enable_testing()

add_executable(kernel_tests tests/test_main.cpp tests/test_solver.cpp tests/test_transform.cpp tests/test_curves.cpp tests/test_geodesy.cpp tests/test_clothoid.cpp tests/test_tin.cpp tests/test_octree.cpp tests/test_quadtree.cpp tests/test_selection.cpp tests/test_scene_graph.cpp tests/test_pathfinding.cpp tests/test_seating_layout.cpp tests/test_crs.cpp tests/test_vertical_alignment.cpp tests/test_mass_properties.cpp tests/test_dimensioning.cpp tests/test_io.cpp tests/test_apple_engine.cpp tests/test_apple_intents.cpp tests/test_apple_collaboration.cpp tests/test_apple_audio.cpp tests/test_menu_designer.cpp tests/test_floor_plan.cpp)
target_compile_options(kernel_tests PRIVATE -Wall -Wextra -Wpedantic -Werror -O3 -fno-fast-math)
target_link_libraries(kernel_tests PRIVATE apple ops core io solver geom gtest_main)
add_test(NAME kernel_tests COMMAND kernel_tests)
