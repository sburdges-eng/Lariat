// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "LariatNative",
    platforms: [.macOS(.v14), .iOS(.v17)],
    dependencies: [
        .package(url: "https://github.com/groue/GRDB.swift.git", from: "6.29.0")
    ],
    targets: [
        .target(
            name: "LariatModel",
            dependencies: [
                .product(name: "GRDB", package: "GRDB.swift")
            ]
        ),
        .target(
            name: "LariatDB",
            dependencies: [
                "LariatModel",
                .product(name: "GRDB", package: "GRDB.swift")
            ]
        ),
        .executableTarget(
            name: "LariatApp",
            dependencies: ["LariatDB", "LariatModel"]
        ),
        .testTarget(
            name: "LariatModelTests",
            dependencies: [
                "LariatModel",
                .product(name: "GRDB", package: "GRDB.swift")
            ]
        ),
        .testTarget(
            name: "LariatDBTests",
            dependencies: [
                "LariatDB",
                .product(name: "GRDB", package: "GRDB.swift")
            ]
        ),
    ]
)
