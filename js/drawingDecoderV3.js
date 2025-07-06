import { arrayToTextLines, map } from "./utils.js";

// version 3 (latest) of the drawing decoder class
// still naive but applies a bit more appropriate maths
// takes into account basic radial lens distortion with a single k term
// primarily works by estimating the distance to each ball and triangulating a camera position
// considers position of each ball in the image to get a more accurate range estimation
// calculates a z estimate to decide if pen is in contact with paper or not
// applies smoothing based on last estimated xyz position
// still assumes that camera position x and y are equivalent to pen tip x and y
export default class DrawingDecoder {

    constructor(k1 = 0, smooth = 0, zThreshold = 0) {
        this.collector = [];                // collector stores the decoded XY image coordinates for later export
        this.k1 = k1;                       // radial lens distortion correction coefficient
        this.smooth = smooth;               // smoothing factor (0-1)
        this.zThreshold = zThreshold;       // z-threshold for deciding if pen is in contact with paper
    }


    // takes a 2d context to draw onto and a 'balls' object describing the size and position of each ball in the current frame
    decode(ctx, balls) {

        // transform ball positions and sizes according to distortion parameter k1
        const undistortedBalls = this.#undistortBalls(balls);

        // estimate range to each of the three balls based on size and position
        const redRange = this.#getRange(undistortedBalls.red);
        const greenRange = this.#getRange(undistortedBalls.green);
        const blueRange = this.#getRange(undistortedBalls.blue);

        // triangulate camera position vertically and horizontally
        const camPositionVertical = this.#triangulate(7.79, redRange, (blueRange + greenRange) / 2);    // 7.79cm is vertical 'baseline' of 9cm triangle
        const camPositionHorizontal = this.#triangulate(9, blueRange, greenRange);                      // 9cm is horizontal 'baseline' of 9cm triangle

        // map observed x and y values to canvas pixel range
        let x = map(camPositionHorizontal.x, -29, 16, 150, 550);
        let y = map((camPositionHorizontal.y + camPositionVertical.y) / 2, 31, 58, 150, 575);

        // sign is inverted - i maybe did something backwards
        let z = -camPositionVertical.x;

        // udpate drawing if camera (pen) has moved 
        if (this.lastPosition && (x != this.lastPosition.x || y != this.lastPosition.y)) {

            // apply smoothing as weighted average
            x = x * (1 - this.smooth) + this.lastPosition.x * this.smooth;
            y = y * (1 - this.smooth) + this.lastPosition.y * this.smooth;
            z = z * (1 - this.smooth) + this.lastPosition.z * this.smooth;

            // if z exceeds threshold stop drawing - pen is off paper
            if (z > this.zThreshold) {
                this.lastPosition = null;
                return;
            }

            // draw from last position to current position
            ctx.beginPath();
            ctx.moveTo(this.lastPosition.x, this.lastPosition.y);
            ctx.lineTo(x, y);
            ctx.stroke();

            // store x and y canvas integer pixel coordinates
            this.collector.push(Math.round(x) + ' ' + Math.round(y));

        }

        // update last position
        this.lastPosition = { x, y, z };

    }


    // helper to perform undistortion on each ball, saves code duplication
    #undistortBalls(balls) {
        return {
            red: this.#undistortBall(balls.red),
            green: this.#undistortBall(balls.green),
            blue: this.#undistortBall(balls.blue)
        }
    }


    // to undistort each ball have to undistort centroid and radius  using different methods
    #undistortBall(ball) {
        return {
            centroid: this.#undistortPoint(ball.centroid),
            radius: this.#undistortRadius(ball)
        };
    }


    // if original ball size was calculated based on a distorted image then undistort a set of
    // uniformly distributed points around its circumference and calculate the size of that instead
    // possible overly convoluted
    #undistortRadius(ball) {
        const circPoints = [];
        const count = 10;

        for (let i = 0; i < count; i++) {                                   // calculate points on circumference of original 'distorted' ball
            const angle = (i / count) * Math.PI * 2;
            const x = ball.centroid.x + (ball.radius * Math.cos(angle));
            const y = ball.centroid.y + (ball.radius * Math.sin(angle));
            circPoints.push(this.#undistortPoint({ x, y }));                // undistort each point to create an 'undistorted' ball
        }

        let area = 0;                                                       // use shoelace formula: https://en.wikipedia.org/wiki/Shoelace_formula
        for (let i = 0; i < count; i++) {                                   // to calculate area of new 'undistorted' polygon
            const j = i === count - 1 ? 0 : i + 1;
            area += ((circPoints[i].x * circPoints[j].y) - (circPoints[j].x * circPoints[i].y));
        }
        area = area / 2;

        return Math.sqrt(area / Math.PI);                                   // calculate and return radius based on this 'undistorted' area
    }


    // transform any point in the original distorted image to a xy position in an ideal pinhole camera model
    // using division model with single distortion term k1: https://en.wikipedia.org/wiki/Distortion_(optics)
    // full distortion model uses multiple terms k1...kn and more for tangential and decentering distortion
    // but more than 1 term would be hard to tune through trial and error, and 1 term gets us a lot of the way
    #undistortPoint(point) {
        const k1 = this.k1;                                                 // negative k1 = barrel distortion / positive k1 = pincushion
        const center = { x: 640, y: 360 };                                  // hard coded video dimensions - sorry!
        const r = Math.sqrt(Math.pow(point.x - center.x, 2) + Math.pow(point.y - center.y, 2));
        const newX = center.x + ((point.x - center.x) / (1 + (k1 * Math.pow(r, 2))));
        const newY = center.y + ((point.y - center.y) / (1 + (k1 * Math.pow(r, 2))));
        return { x: newX, y: newY };
    }


    // calculate distance from camera to given ball in cm using centroid and radius
    #getRange(ball) {

        const x = map(ball.centroid.x - 640, 0, 640, 0, 15.24);             // map pixel position to cm position on camera sensor if camera sensor imaged
        const y = map(ball.centroid.y - 360, 0, 360, 0, 8.58);              // the scene at 1:1 scale when range is 18cm - based on 2D CAD model mockup

        const a = 0.240;                                                    // these quadratic formula coefficients established through simulating size of
        const b = 0.077;                                                    // ball at fixed range on camera sensor at different distances from image center
        const c = 104.62;                                                   // values were plotted in excel and 2nd-order polynomial trendline calculated

        const offsetXFactor = a * Math.pow(x, 2) + b * x + c;               // how much the size of the ball is affected by its horizontal position in the image
        const offsetYFactor = a * Math.pow(y, 2) + b * y + c;               // how much the size of the ball is affected by its vertical position in the image

        const offsetFactor = Math.sqrt(Math.pow(offsetXFactor, 2) + Math.pow(offsetYFactor, 2));        // pythagoras to get the overall effect

        // ball radius is in pixels so map to cm based on same proportions as above mapping, but doubled to convert from radius to diameter
        const ballSizeCM = map(ball.radius, 0, 107.5, 0, 5.12);

        // distance to the given ball is equal to the the above calculated offset factor divided by the ball diameter in cm on the sensor
        // assuming the camera sensor images at 1:1 when the camera is 18cm from the balls
        return offsetFactor / ballSizeCM;

    }


    // given lengths of three sides of a triangle, calculate the position of point where b meets c (camera position)
    // assuming side a defines the x axis and the origin is where a meets c
    // there is probably a mathematical identity for this, but i worked it out from pythagoras
    // b and c are the distances from the camera to different balls based on result of this.#getRange()
    // a is the distance between the balls which is known
    #triangulate(a, b, c) {
        const x = (Math.pow(b, 2) - Math.pow(a, 2) - Math.pow(c, 2)) / (2 * a);
        const y = Math.sqrt(Math.pow(c, 2) - Math.pow(x, 2));
        return { x, y };
    }


    // return the string representation of the collector
    // a string of space-separated XY pairs on each line
    toString() {
        return arrayToTextLines(this.collector);
    }

}