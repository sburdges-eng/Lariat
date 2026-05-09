
#pragma once
#include <vector>
#include <functional>
#include <memory>
#include <expected>
#include <concepts>
#include <string>

namespace floorplan::solver {

template<typename T>
concept FloatType = std::floating_point<T>;

class ConstraintSystem {
public:
    using VectorXd = std::vector<double>;
    using MatrixXd = std::vector<std::vector<double>>;
    using ResidualFunc = std::function<VectorXd(const VectorXd&)>;
    using JacobianFunc = std::function<MatrixXd(const VectorXd&)>;

    constexpr ConstraintSystem(ResidualFunc r, JacobianFunc j) : residual_(std::move(r)), jacobian_(std::move(j)) {}

    [[nodiscard]] std::expected<VectorXd, std::string> solve(const VectorXd& initial_guess, double tolerance = 1e-9, int max_iterations = 100) const;

private:
    ResidualFunc residual_;
    JacobianFunc jacobian_;

    [[nodiscard]] std::expected<MatrixXd, std::string> invertMatrix(const MatrixXd& mat) const;
    [[nodiscard]] VectorXd multiply(const MatrixXd& mat, const VectorXd& vec) const;
    [[nodiscard]] VectorXd subtract(const VectorXd& v1, const VectorXd& v2) const;
    [[nodiscard]] double norm(const VectorXd& vec) const;
};

} // namespace floorplan::solver
