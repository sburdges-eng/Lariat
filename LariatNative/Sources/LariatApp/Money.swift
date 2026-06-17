import Foundation

public func formatDollars(_ value: Double, decimals: Int = 0) -> String {
    let f = NumberFormatter(); f.numberStyle = .currency; f.currencyCode = "USD"
    f.minimumFractionDigits = decimals; f.maximumFractionDigits = decimals
    return f.string(from: value as NSNumber) ?? "$\(value)"
}
