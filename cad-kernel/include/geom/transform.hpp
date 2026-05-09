#pragma once
#include <array>
#include <cmath>
#include <utility>

namespace floorplan::geom {

class AffineMatrix2D {
public:
    constexpr AffineMatrix2D() : m_{1, 0, 0, 0, 1, 0, 0, 0, 1} {}

    constexpr AffineMatrix2D(double m00, double m01, double m02,
                             double m10, double m11, double m12,
                             double m20, double m21, double m22)
        : m_{m00, m01, m02, m10, m11, m12, m20, m21, m22} {}

    [[nodiscard]] constexpr AffineMatrix2D multiply(const AffineMatrix2D& other) const {
        return AffineMatrix2D(
            m_[0]*other.m_[0] + m_[1]*other.m_[3] + m_[2]*other.m_[6],
            m_[0]*other.m_[1] + m_[1]*other.m_[4] + m_[2]*other.m_[7],
            m_[0]*other.m_[2] + m_[1]*other.m_[5] + m_[2]*other.m_[8],
            
            m_[3]*other.m_[0] + m_[4]*other.m_[3] + m_[5]*other.m_[6],
            m_[3]*other.m_[1] + m_[4]*other.m_[4] + m_[5]*other.m_[7],
            m_[3]*other.m_[2] + m_[4]*other.m_[5] + m_[5]*other.m_[8],
            
            m_[6]*other.m_[0] + m_[7]*other.m_[3] + m_[8]*other.m_[6],
            m_[6]*other.m_[1] + m_[7]*other.m_[4] + m_[8]*other.m_[7],
            m_[6]*other.m_[2] + m_[7]*other.m_[5] + m_[8]*other.m_[8]
        );
    }

    [[nodiscard]] static constexpr AffineMatrix2D translation(double tx, double ty) {
        return AffineMatrix2D(1, 0, tx, 0, 1, ty, 0, 0, 1);
    }

    [[nodiscard]] static AffineMatrix2D rotation(double theta_rad) {
        double c = std::cos(theta_rad);
        double s = std::sin(theta_rad);
        return AffineMatrix2D(c, -s, 0, s, c, 0, 0, 0, 1);
    }

    [[nodiscard]] static constexpr AffineMatrix2D scaling(double sx, double sy) {
        return AffineMatrix2D(sx, 0, 0, 0, sy, 0, 0, 0, 1);
    }

    [[nodiscard]] constexpr std::pair<double, double> transformPoint(double x, double y) const {
        return {
            m_[0] * x + m_[1] * y + m_[2],
            m_[3] * x + m_[4] * y + m_[5]
        };
    }

private:
    std::array<double, 9> m_;
};

} // namespace floorplan::geom