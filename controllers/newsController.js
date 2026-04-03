import News from "../models/News.js";
import { sendError } from "../utils/apiResponse.js";

export const getTrendingNews = async (req, res) => {
  try {
    const schoolId = req.student.schoolId?.toString() || null;
    const news = await News.find({
      isTrending: true,
      $or: [{ schoolId: null }, ...(schoolId ? [{ schoolId }] : [])],
    })
      .sort({ publishedAt: -1 })
      .limit(20);

    return res.status(200).json(
      news.map((item) => ({
        _id: item._id.toString(),
        title: item.title,
        description: item.description,
        imageUrl: item.imageUrl,
        publishedAt: item.publishedAt.toISOString(),
      }))
    );
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to load trending news");
  }
};
