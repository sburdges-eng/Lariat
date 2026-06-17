import XCTest
@testable import LariatModel

/// Parity with `tests/js/test-performance-reviews-rules.mjs`.
final class PerformanceReviewComputeTests: XCTestCase {
    func testClassifyExceptional() {
        let res = PerformanceReviewCompute.classifyReview(
            PerformanceReviewScores(punctualityScore: 5, techniqueScore: 4, speedScore: 5)
        )
        XCTAssertEqual(res.status, .green)
        XCTAssertEqual(res.label, "Exceptional")
        XCTAssertEqual(res.averageScore, 4.7)
    }

    func testClassifyGreat() {
        let res = PerformanceReviewCompute.classifyReview(
            PerformanceReviewScores(punctualityScore: 4, techniqueScore: 4, speedScore: 4)
        )
        XCTAssertEqual(res.status, .green)
        XCTAssertEqual(res.label, "Great")
        XCTAssertEqual(res.averageScore, 4.0)
    }

    func testClassifyGood() {
        let res = PerformanceReviewCompute.classifyReview(
            PerformanceReviewScores(punctualityScore: 3, techniqueScore: 4, speedScore: 3)
        )
        XCTAssertEqual(res.status, .amber)
        XCTAssertEqual(res.label, "Good")
        XCTAssertEqual(res.averageScore, 3.3)
    }

    func testClassifySolid() {
        let res = PerformanceReviewCompute.classifyReview(
            PerformanceReviewScores(punctualityScore: 2, techniqueScore: 3, speedScore: 3)
        )
        XCTAssertEqual(res.status, .amber)
        XCTAssertEqual(res.label, "Solid")
        XCTAssertEqual(res.averageScore, 2.7)
    }

    func testClassifyNeedsImprovement() {
        let res = PerformanceReviewCompute.classifyReview(
            PerformanceReviewScores(punctualityScore: 2, techniqueScore: 2, speedScore: 2)
        )
        XCTAssertEqual(res.status, .red)
        XCTAssertEqual(res.label, "Needs Improvement")
        XCTAssertEqual(res.averageScore, 2.0)
    }

    func testClassifyNoScores() {
        let res = PerformanceReviewCompute.classifyReview(
            PerformanceReviewScores(punctualityScore: 0, techniqueScore: 0, speedScore: 0)
        )
        XCTAssertEqual(res.status, .gray)
        XCTAssertEqual(res.label, "No scores")
    }

    func testValidateAcceptsValid() {
        XCTAssertNil(
            PerformanceReviewCompute.validateScores(
                PerformanceReviewScores(punctualityScore: 1, techniqueScore: 3, speedScore: 5)
            )
        )
    }

    func testValidateRejectsBelowOne() {
        let err = PerformanceReviewCompute.validateScores(
            PerformanceReviewScores(punctualityScore: 0, techniqueScore: 3, speedScore: 5)
        )
        XCTAssertTrue(err?.contains("On Time") == true)
    }

    func testValidateRejectsAboveFive() {
        let err = PerformanceReviewCompute.validateScores(
            PerformanceReviewScores(punctualityScore: 5, techniqueScore: 6, speedScore: 5)
        )
        XCTAssertTrue(err?.contains("Technique") == true)
    }
}
