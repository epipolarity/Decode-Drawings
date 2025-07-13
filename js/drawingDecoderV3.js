import { arrayToTextLines, map } from "./utils.js";
import { undistortPoint, undistortRadius } from "./undistort.js";

// version 3 (latest) of the drawing decoder class
// still naive but applies a bit more appropriate maths
// takes into account basic radial lens distortion with a single k term
// works by estimating the distance to each ball and trilaterating a camera position
// considers ball's position within the frame to get a more accurate range estimation
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

        // trilaterate camera position vertically and horizontally
        const camPositionVertical = this.#trilaterate(7.79, redRange, (blueRange + greenRange) / 2);    // 7.79cm is vertical 'baseline' of 9cm triangle
        const camPositionHorizontal = this.#trilaterate(9, blueRange, greenRange);                      // 9cm is horizontal 'baseline' of 9cm triangle

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
            centroid: undistortPoint(ball.centroid, 1280, 720, this.k1),
            radius: undistortRadius(ball.centroid, ball.radius, 1280, 720, this.k1)
        };
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
    #trilaterate(a, b, c) {
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