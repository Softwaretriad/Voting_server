export const hasStudentVotedInCategory = ({ election, studentId, categoryId }) => {
  const normalizedStudentId = String(studentId || "");
  const normalizedCategoryId = String(categoryId || "");

  return (election?.votes || []).some((vote) => {
    if (vote.studentId?.toString() !== normalizedStudentId) {
      return false;
    }

    if (vote.electionId?.toString() !== election?._id?.toString()) {
      return false;
    }

    return vote.categoryId?.toString() === normalizedCategoryId;
  });
};

export const hasAdminVotedInCategory = ({ election, adminId, categoryId }) => {
  const normalizedAdminId = String(adminId || "");
  const normalizedCategoryId = String(categoryId || "");

  return (election?.votes || []).some((vote) => {
    if (vote.adminId?.toString() !== normalizedAdminId) {
      return false;
    }

    if (vote.electionId?.toString() !== election?._id?.toString()) {
      return false;
    }

    return vote.categoryId?.toString() === normalizedCategoryId;
  });
};
